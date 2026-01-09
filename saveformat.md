# Save Format

This file documents the JSON structure produced by the app when saving or exporting data.

Purpose: plan and monitor monthly cash movement and debts.

## Top-level object (export file)

All saved files are a single JSON object with these keys:

- transactions: object mapping date strings (YYYY-MM-DD) to arrays of transactions
- monthlyBalances: object mapping date strings (YYYY-MM-DD) to balance numbers
- recurringTransactions: array of recurring transaction definitions
- skippedTransactions: object mapping date strings (YYYY-MM-DD) to arrays of recurring IDs
- debts: array of debt records (debt snowball)
- debtSnowballSettings: snowball settings
- lastExported: ISO-8601 timestamp string
- appVersion: version string

## Top-level object (cloud payload)

Cloud sync stores the same export data and may add:

- lastUpdated: ISO-8601 timestamp string
- autoSyncEnabled: boolean

## transactions

Type: object

- Key: date string in YYYY-MM-DD
- Value: array of transaction objects

Transaction fields:

- amount: number
- type: "expense" | "income" | "balance"
- description: string
- recurringId: string (optional)
- modifiedInstance: boolean (optional)
- originalDate: string YYYY-MM-DD (optional, for adjusted recurring instances)
- debtId: string (optional)
- debtRole: "minimum" | "snowball" (optional)
- debtName: string (optional)
- snowballMonth: string (optional, format: "YYYY-M")
- snowballGenerated: boolean (optional)

Example:

```
"transactions": {
  "2024-05-01": [
    {
      "amount": 250.00,
      "type": "expense",
      "description": "Debt Payment: Card A",
      "recurringId": "rec-1",
      "debtId": "debt-1",
      "debtRole": "minimum",
      "debtName": "Card A"
    },
    {
      "amount": 75.00,
      "type": "expense",
      "description": "Snowball Payment: Card A",
      "debtId": "debt-1",
      "debtRole": "snowball",
      "debtName": "Card A",
      "snowballMonth": "2024-5",
      "snowballGenerated": true
    }
  ]
}
```

## monthlyBalances

Type: object

- Key: date string in YYYY-MM-DD
- Value: number (balance)

Example:

```
"monthlyBalances": {
  "2024-05-01": 1200.50
}
```

## recurringTransactions

Type: array of objects

Common fields:

- id: string
- startDate: string YYYY-MM-DD
- endDate: string YYYY-MM-DD (optional)
- amount: number
- type: "expense" | "income" | "balance"
- description: string
- recurrence: "once" | "daily" | "weekly" | "bi-weekly" | "monthly" | "semi-monthly" | "quarterly" | "semi-annual" | "yearly" | "custom"
- maxOccurrences: number (optional)

Optional recurrence options:

- daySpecific: boolean
- daySpecificData: string (format "N-D" where N is occurrence and D is day-of-week; "-1-1" means last Monday)
- businessDayAdjustment: "none" | "previous" | "next" | "nearest"
- semiMonthlyDays: array of two numbers (optional)
- semiMonthlyLastDay: boolean (optional)
- customInterval: object { unit: "days" | "weeks" | "months", value: number }
- variableAmount: boolean (optional)
- variableType: "percentage" (optional)
- variablePercentage: number (optional)

Debt-related optional fields:

- debtId: string
- debtRole: "minimum"
- debtName: string

Example:

```
"recurringTransactions": [
  {
    "id": "rec-1",
    "startDate": "2000-01-15",
    "amount": 250.00,
    "type": "expense",
    "description": "Debt Payment: Card A",
    "recurrence": "monthly",
    "debtId": "debt-1",
    "debtRole": "minimum",
    "debtName": "Card A"
  }
]
```

## skippedTransactions

Type: object

- Key: date string in YYYY-MM-DD
- Value: array of recurring transaction IDs (strings)

Example:

```
"skippedTransactions": {
  "2024-05-15": ["rec-1"]
}
```

## debts

Type: array of objects

Fields:

- id: string
- name: string
- balance: number
- minPayment: number
- dueDay: number (1-31)
- interestRate: number
- minRecurringId: string (optional)

Example:

```
"debts": [
  {
    "id": "debt-1",
    "name": "Card A",
    "balance": 3200.00,
    "minPayment": 75.00,
    "dueDay": 15,
    "interestRate": 19.99,
    "minRecurringId": "rec-1"
  }
]
```

## debtSnowballSettings

Type: object

Fields:

- extraPayment: number
- autoGenerate: boolean

Example:

```
"debtSnowballSettings": {
  "extraPayment": 100.00,
  "autoGenerate": true
}
```
