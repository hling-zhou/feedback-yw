#!/usr/bin/env python3
"""
全量审计脚本 v3：对照处理意见原文，验证 7-8月投诉+咨询工单的
  1) 客户请求(customerRequest)提取准确性
  2) 痛点(painPoint)提取准确性
  3) 打标(requestScene/problemType/journey)准确性
  4) 优化建议(optimizationSuggestion)准确性

v3 变更：修复 import bug 后重跑；去掉 opt_irrelevant 假阳性；增加 requestScene vs problemType 交叉验证。
"""

import sqlite3, json, re, os, sys
from collections import Counter, defaultdict

DB_PATH = "server/data/auth.db"
OUT_PATH = "dist/audit-tagging-20260909.json"

# ============================================================
# 处理意见全文解析
# ============================================================

def parse_handling_sections(handling_text):
    if not handling_text:
        return {"sentences": [], "root_cause": [], "actions": [], "voice_echo": [], "template": [], "is_substantive": False}
    sentences = [s.strip() for s in re.split(r'[。；\n]+', handling_text) if len(s.strip()) > 3]
    rc_re = re.compile(r'(经(?:排查|核实)|定位为|确认为|实际(?:为|是)|属于|判定为|根因为?[:：]|原因[:：]|问题原因[:：]|由于.+?导致|问题在于|问题出在)')
    action_re = re.compile(r'(已(?:通知|告知|协助|指导|回电|处理|解决|关闭|退订|解绑|绑定|配置|调整|恢复|申请|提交|联系)|请(?:客户|协助|帮忙|后台|服务台)|建议客户|协助客户|已为客户|代客户|发起|执行)')
    voice_re = re.compile(r'(客户(?:反馈|表示|要求|咨询|原话|反应|已|自行)|用户(?:反馈|表示))')
    template_re = re.compile(r'(敏感信息|机密信息|请.*提供|请.*扫码|请.*进群|如有问题.*咨询|工单保留|暂未回复|待客户|电话未接通|稍后再联系)')
    result = {"sentences": sentences, "root_cause": [], "actions": [], "voice_echo": [], "template": [], "is_substantive": False}
    for s in sentences:
        if rc_re.search(s): result["root_cause"].append(s)
        if action_re.search(s): result["actions"].append(s)
        if voice_re.search(s): result["voice_echo"].append(s)
        if template_re.search(s): result["template"].append(s)
    result["is_substantive"] = bool(result["root_cause"] or result["actions"])
    return result

def extract_title_node(raw, handling):
    full = (raw or "") + "\n" + (handling or "")
    title_m = re.search(r'工单标题[：:]([^\n]+)', full)
    node_m = re.search(r'(?:请求节点|系统路径)[：:]([^\n]+)', full)
    return {"title": title_m.group(1).strip() if title_m else "", "node": node_m.group(1).strip() if node_m else ""}

# ============================================================
# 客户请求 & 痛点质量
# ============================================================

def audit_customer_request(payload):
    cr = (payload.get("customerRequest") or "").strip()
    raw = (payload.get("rawText") or "")
    handling = (payload.get("handlingText") or "")
    issues = []
    if not cr: issues.append({"type": "cr_empty", "severity": "high"})
    elif len(cr) < 5: issues.append({"type": "cr_too_short", "severity": "high", "value": cr})
    elif re.match(r'^(?:无|不涉及|暂无|N/?A|—|-|\s*)$', cr, re.IGNORECASE): issues.append({"type": "cr_placeholder", "severity": "high", "value": cr})
    tn = extract_title_node(raw, handling)
    if tn["title"] and tn["title"].strip() == cr.strip(): issues.append({"type": "cr_is_title_only", "severity": "medium"})
    if re.match(r'^[\\N\s]*$', cr) or cr == '\\N': issues.append({"type": "cr_is_null_char", "severity": "high"})
    if re.search(r'(?:处理意见|受理内容|反馈&客服组)', cr): issues.append({"type": "cr_has_handling_leak", "severity": "high"})
    return issues

def audit_pain_point(payload):
    pp = (payload.get("painPoint") or "").strip()
    cr = (payload.get("customerRequest") or "").strip()
    issues = []
    if not pp or pp == '\\N': issues.append({"type": "pp_empty", "severity": "medium"})
    if cr and pp and cr.strip() == pp.strip(): issues.append({"type": "pp_same_as_cr", "severity": "medium"})
    if cr and pp and len(pp) < len(cr) and cr.startswith(pp): issues.append({"type": "pp_is_cr_truncation", "severity": "low"})
    return issues

# ============================================================
# 标签准确性
# ============================================================

QUOTA_KW = re.compile(r'(提升配额|带宽配额|配额到期|配额恢复|扩容配额|增加配额|增加IP|轻载IP|灰度|解除8:1|配额.*有效期|有效期.*配额|到期.*恢复.*原|恢复.*原值|恢复.*原配|申请.*提升.*至|提升.*至.*\d+|申请延长有效期|配额不足|配额超限|配额已满)')
OPERATION_KW = re.compile(r'(退订\d+|退订[^询]|订购\d+|开通\d+|创建.*(?:实例|云主机|子网|VPC)|申请.*(?:公网|EIP|带宽|IP))')
CONSULT_KW = re.compile(r'(咨询|请问|怎么|如何|是否支持|能不能|可否|可以.*吗|能否|想问|想了解)')

def extract_handling_signal(handling_text):
    if not handling_text: return set()
    signals = set()
    for pat_name, pat in [
        ("quota", r'(配额|QPS|限速|限流|轻载)'),
        ("bandwidth", r'(带宽|网速|mbps|Mbps|限速|跑满|跑不满)'),
        ("security_group", r'(安全组|防火墙|端口(?!号)|ACL规则)'),
        ("route_subnet", r'(子网|路由|CIDR|VPC.*路由|路由表)'),
        ("unsubscribe", r'(退订|释放|销毁|删除.*(?:实例|资源))'),
        ("subscribe_create", r'(订购|开通|购买|创建.*(?:实例|EIP|带宽))'),
        ("connectivity", r'(不通|连通|PING|ping|访问不了|连不上|网络不通)'),
        ("delay_loss", r'(丢包|延时|延迟|卡顿|抖动|高延迟)'),
        ("billing", r'(出账|欠费|扣费|计费|账单|费用|扣款)'),
        ("dns_cert", r'(DNS|域名|证书|SSL|TLS|解析)'),
        ("change", r'(变更|修改|调整|迁移|割接)'),
        ("bind_unbind", r'(绑定|解绑|关联|取消关联)'),
        ("consult_info", r'(咨询|了解|确认.*是否|查询.*状态)'),
    ]:
        if re.search(pat, handling_text): signals.add(pat_name)
    return signals

def audit_tagging(payload):
    cr = (payload.get("customerRequest") or "").strip()
    pp = (payload.get("painPoint") or "").strip()
    handling = (payload.get("handlingText") or "").strip()
    request_scene = (payload.get("requestScene") or "").strip()
    problem_type = (payload.get("problemType") or "").strip()
    journey_l1 = (payload.get("journeyL1") or "").strip()
    journey_l2 = (payload.get("journeyL2") or "").strip()
    
    primary_text = (cr + "\n" + pp).strip() if pp else cr
    full_text = primary_text + "\n" + handling
    issues = []
    
    # A. requestScene 为空
    if not request_scene:
        issues.append({"type": "requestScene_empty", "severity": "high"})
    
    # B. 配额类标为报障与排错
    if request_scene == "报障与排错" and QUOTA_KW.search(full_text):
        h_signals = extract_handling_signal(handling)
        if ("quota" in h_signals or "bandwidth" in h_signals) and "connectivity" not in h_signals and "delay_loss" not in h_signals:
            issues.append({"type": "requestScene_quota_as_fault", "severity": "high"})
    
    # C. 咨询类标为报障与排错
    if request_scene == "报障与排错" and CONSULT_KW.search(primary_text):
        h_signals = extract_handling_signal(handling)
        if "consult_info" in h_signals and "connectivity" not in h_signals:
            issues.append({"type": "requestScene_consult_as_fault", "severity": "high"})
    
    # D. 退订/订购操作标为产品信息咨询
    if request_scene == "产品信息咨询" and OPERATION_KW.search(full_text):
        h_signals = extract_handling_signal(handling)
        if "unsubscribe" in h_signals or "subscribe_create" in h_signals:
            issues.append({"type": "requestScene_operation_as_consult", "severity": "medium"})
    
    # E. 配额工单标为可用性/连通性故障
    if problem_type and "可用性" in problem_type and QUOTA_KW.search(full_text):
        h_signals = extract_handling_signal(handling)
        if ("quota" in h_signals or "bandwidth" in h_signals) and "connectivity" not in h_signals:
            issues.append({"type": "problemType_quota_as_availability", "severity": "high"})
    
    # F. 安全组问题未标配置类（仅当处理意见明确是安全组规则问题）
    if handling:
        h_signals = extract_handling_signal(handling)
        if "security_group" in h_signals and problem_type and "配置" not in problem_type and "安全组" not in problem_type:
            if re.search(r'(安全组.*规则|安全组.*配置|安全组.*放通|安全组.*未放通|安全组.*拒|防火墙.*规则)', handling):
                issues.append({"type": "problemType_sg_not_config", "severity": "medium", "detail": f"安全组问题标为{problem_type}"})
    
    # G. journey 为空
    if not journey_l1:
        issues.append({"type": "journeyL1_empty", "severity": "medium"})
    
    # H. journey 为无法识别
    if journey_l1 in ["全局流转", "业务规则咨询/查询-全局流转", "无法识别"]:
        issues.append({"type": "journey_default", "severity": "low", "detail": journey_l1})
    
    # I. requestScene=报障与排错 但 problemType 不在故障/性能/其他 → 不一致
    if request_scene == "报障与排错" and problem_type:
        expected_for_fault = {"可用性/连通性故障", "性能问题", "其他"}
        if problem_type not in expected_for_fault and "故障" not in problem_type and "性能" not in problem_type:
            issues.append({"type": "rs_vs_pt_mismatch", "severity": "medium", "detail": f"报障排错+{problem_type}"})
    
    # J. requestScene=资源操作申请 但 problemType=可用性/连通性故障 → 可能不一致
    if request_scene == "资源操作申请" and problem_type and "可用性" in problem_type:
        issues.append({"type": "resource_op_but_availability_pt", "severity": "low", "detail": "资源操作申请但标可用性故障"})
    
    return issues

# ============================================================
# 优化建议质量检测
# ============================================================

def audit_optimization(payload):
    opt = (payload.get("optimizationSuggestion") or "").strip()
    issues = []
    if not opt or opt == '\\N': issues.append({"type": "opt_empty", "severity": "medium"})
    elif len(opt) < 10: issues.append({"type": "opt_too_short", "severity": "low"})
    return issues

# ============================================================
# 主流程
# ============================================================

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    # 只看 taxonomy-dev（导入的 7-8月数据），不含 pre-existing local 数据
    cur.execute("""
        SELECT payload FROM records 
        WHERE tenant_id='taxonomy-dev'
        AND data_source_type IN ('complaint_ticket', 'consultation_ticket') 
        AND payload IS NOT NULL
        ORDER BY ROWID
    """)
    rows = cur.fetchall()
    
    total = 0
    cr_issues_count = Counter()
    pp_issues_count = Counter()
    tag_issues_count = Counter()
    opt_issues_count = Counter()
    
    # 样本收集
    problem_samples = defaultdict(list)
    
    for row in rows:
        try: p = json.loads(row["payload"])
        except: continue
        total += 1
        cr = (p.get("customerRequest") or "").strip()
        pp = (p.get("painPoint") or "").strip()
        handling = (p.get("handlingText") or "").strip()
        
        # 1. 客户请求
        for iss in audit_customer_request(p):
            cr_issues_count[iss["type"]] += 1
            if len(problem_samples.get(iss["type"], [])) < 8:
                problem_samples[iss["type"]].append({
                    "product": p.get("product", ""), "cr": cr[:200],
                    "handling_excerpt": (handling or "")[:300],
                    "title_node": extract_title_node(p.get("rawText",""), handling),
                })
        
        # 2. 痛点
        for iss in audit_pain_point(p):
            pp_issues_count[iss["type"]] += 1
            if len(problem_samples.get(iss["type"], [])) < 8:
                problem_samples[iss["type"]].append({
                    "product": p.get("product", ""), "cr": cr[:150], "pp": pp[:150],
                    "handling_excerpt": (handling or "")[:300],
                })
        
        # 3. 打标
        for iss in audit_tagging(p):
            tag_issues_count[iss["type"]] += 1
            if len(problem_samples.get(iss["type"], [])) < 10:
                problem_samples[iss["type"]].append({
                    "product": p.get("product", ""),
                    "requestScene": p.get("requestScene", ""),
                    "problemType": p.get("problemType", ""),
                    "journeyL1": p.get("journeyL1", ""),
                    "journeyL2": p.get("journeyL2", ""),
                    "cr": cr[:200], "pp": pp[:150],
                    "handling_excerpt": (handling or "")[:500],
                    "detail": iss.get("detail", ""),
                })
        
        # 4. 优化建议
        for iss in audit_optimization(p):
            opt_issues_count[iss["type"]] += 1
            if len(problem_samples.get(iss["type"], [])) < 8:
                problem_samples[iss["type"]].append({
                    "product": p.get("product", ""),
                    "requestScene": p.get("requestScene", ""),
                    "cr": cr[:150],
                    "optimizationSuggestion": (p.get("optimizationSuggestion") or "")[:200],
                })
    
    conn.close()
    
    # 组装结果
    result = {
        "audit_time": "2026-09-09-v3",
        "audit_scope": "taxonomy-dev (7-8月导入数据)",
        "total_tickets": total,
        "customer_request": {"summary": dict(cr_issues_count), "samples": dict(problem_samples)},
        "pain_point": {"summary": dict(pp_issues_count), "samples": dict(problem_samples)},
        "tagging": {"summary": dict(tag_issues_count), "samples": dict(problem_samples)},
        "optimization": {"summary": dict(opt_issues_count), "samples": dict(problem_samples)},
    }
    
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"=== 审计完成: {total} 条工单 (taxonomy-dev) ===\n")
    
    for section, cnt in [("customerRequest", cr_issues_count), ("painPoint", pp_issues_count), 
                          ("打标(tagging)", tag_issues_count), ("优化建议(optimization)", opt_issues_count)]:
        print(f"--- {section} ---")
        if not cnt: print("  (全部通过)")
        for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
            pct = f" ({v*100//total}%)" if v*100//total > 0 else ""
            print(f"  {k}: {v}{pct}")
        print()
    
    print(f"结果已写入 {OUT_PATH}")

if __name__ == "__main__":
    main()