export const AGING_LABEL = { current: "未到期", "1-30": "逾期 1–30 天", "31-60": "逾期 31–60 天", "61+": "逾期 61 天以上" } as const;

export const SEVERITY_LABEL = { good: "正面", info: "觀察", warn: "注意", risk: "風險" } as const;
export const PRIORITY_LABEL = { high: "優先", medium: "建議", low: "可考慮" } as const;
