/**
 * M2-4 Top10 golden fingerprints（由 scripts/generate-clustering-top10-golden.mjs 生成）
 * 算法有意变更且 τ 门禁更新时重新生成。
 */
/** @type {Record<string, string[]>} */
export const CLUSTERING_TOP10_GOLDEN = {
  "弹性公网 IP": [
    "eip-bind-0|eip-bind-1|eip-bind-2|eip-bind-3|eip-ui-0|eip-ui-1|eip-ui-2|eip-unsub-0|eip-unsub-1|eip-unsub-2",
    "eip-conn-0|eip-conn-1|eip-conn-2|eip-conn-3|eip-conn-4|eip-conn-5",
    "eip-sg-0|eip-sg-1|eip-sg-2|eip-sg-3|eip-sg-4",
    "eip-nat-0|eip-nat-1|eip-nat-2|eip-nat-3",
    "eip-bill-0|eip-bill-1|eip-bill-2|eip-bill-3",
    "eip-drift-0|eip-drift-1|eip-drift-2|eip-drift-3",
    "eip-bw-0|eip-bw-1|eip-bw-2|eip-bw-3|eip-bw-4",
    "eip-shared-0|eip-shared-1|eip-shared-2|eip-shared-3",
    "eip-consult-0|eip-consult-1|eip-consult-2"
  ],
  "VPC": [
    "vpc-route-0|vpc-route-1|vpc-route-2",
    "vpc-peer-0|vpc-peer-1|vpc-peer-2"
  ]
}
