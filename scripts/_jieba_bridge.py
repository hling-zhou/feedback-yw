#!/usr/bin/env python3
"""jieba 分词桥接：从 stdin 读 JSON 文本数组，输出分词后的 JSON 数组到 stdout。
用法：echo '["文本1","文本2"]' | python3 _jieba_bridge.py
"""
import sys, json
import warnings
warnings.filterwarnings("ignore", category=SyntaxWarning)

import jieba

# 静默 jieba 初始化日志
jieba.setLogLevel(60)

def tokenize(text):
    """分词后用空格连接，适合 NLP.js 的 tokenizer 处理"""
    words = jieba.cut(text, cut_all=False)
    return " ".join(words)

def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print("[]")
        return
    texts = json.loads(raw)
    results = [tokenize(t) for t in texts]
    print(json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
