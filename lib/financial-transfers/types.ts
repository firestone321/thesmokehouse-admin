export type FinancialAccountType = "cash" | "mobile_money" | "bank";

export type FinancialAccount = {
  id: number;
  name: string;
  accountType: FinancialAccountType;
};

export type FinancialTransfer = {
  id: number;
  transferNumber: string;
  fromAccount: string;
  toAccount: string;
  amountUgx: number;
  serviceDate: string;
  transferredAt: string;
  externalReference: string | null;
  notes: string | null;
  feeAmountUgx: number;
  createdBy: string;
};
