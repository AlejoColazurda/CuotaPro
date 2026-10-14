import Decimal from 'decimal.js';
import type { InterestType } from '@/types/database';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface AmortizationInput {
  cashPriceCents: number;
  adminFeeCents: number;
  numInstallments: number;
  interestType: InterestType;
  interestRate: number;
  startDate: Date;
  paymentDay?: number;
}

export interface InstallmentSchedule {
  number: number;
  dueDate: Date;
  principalCents: number;
  interestCents: number;
  adminFeeCents: number;
  totalCents: number;
  balanceAfterCents: number;
}

export interface AmortizationResult {
  financedAmountCents: number;
  totalAmountCents: number;
  totalInterestCents: number;
  totalAdminFeeCents: number;
  installments: InstallmentSchedule[];
  tna: number;
  tea: number;
  cft: number;
  monthlyRate: number;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getDueDate(startDate: Date, installmentNumber: number, paymentDay?: number): Date {
  const date = addMonths(startDate, installmentNumber - 1);
  if (paymentDay && paymentDay >= 1 && paymentDay <= 28) {
    date.setDate(paymentDay);
  }
  return date;
}

export function calculateFixedSurcharge(input: AmortizationInput): AmortizationResult {
  const cashPrice = new Decimal(input.cashPriceCents);
  const adminFee = new Decimal(input.adminFeeCents);
  const rate = new Decimal(input.interestRate);
  const n = input.numInstallments;

  const financedAmount = cashPrice;
  const totalInterest = financedAmount.mul(rate);
  const totalWithInterest = financedAmount.add(totalInterest);
  const totalAmount = totalWithInterest.add(adminFee);
  
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const principalPerInstallment = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const interestPerInstallment = totalInterest.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let interest: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      interest = totalInterest.sub(interestPerInstallment.mul(n - 1));
      fee = adminFee.sub(adminFeePerInstallment.mul(n - 1));
    } else {
      principal = principalPerInstallment;
      interest = interestPerInstallment;
      fee = adminFeePerInstallment;
    }

    remainingBalance = remainingBalance.sub(principal);

    installments.push({
      number: i,
      dueDate: getDueDate(input.startDate, i, input.paymentDay),
      principalCents: principal.toNumber(),
      interestCents: interest.toNumber(),
      adminFeeCents: fee.toNumber(),
      totalCents: principal.add(interest).add(fee).toNumber(),
      balanceAfterCents: remainingBalance.toNumber(),
    });
  }

  const monthlyRate = rate.div(n);
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), totalAmount.toNumber(), n);

  return {
    financedAmountCents: financedAmount.toNumber(),
    totalAmountCents: totalAmount.toNumber(),
    totalInterestCents: totalInterest.toNumber(),
    totalAdminFeeCents: adminFee.toNumber(),
    installments,
    tna,
    tea,
    cft,
    monthlyRate: monthlyRate.toNumber(),
  };
}

export function calculateDirectRate(input: AmortizationInput): AmortizationResult {
  const cashPrice = new Decimal(input.cashPriceCents);
  const adminFee = new Decimal(input.adminFeeCents);
  const monthlyRate = new Decimal(input.interestRate);
  const n = input.numInstallments;

  const financedAmount = cashPrice;
  const totalInterest = financedAmount.mul(monthlyRate).mul(n);
  const totalWithInterest = financedAmount.add(totalInterest);
  const totalAmount = totalWithInterest.add(adminFee);

  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const principalPerInstallment = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const interestPerInstallment = totalInterest.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let interest: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      interest = totalInterest.sub(interestPerInstallment.mul(n - 1));
      fee = adminFee.sub(adminFeePerInstallment.mul(n - 1));
    } else {
      principal = principalPerInstallment;
      interest = interestPerInstallment;
      fee = adminFeePerInstallment;
    }

    remainingBalance = remainingBalance.sub(principal);

    installments.push({
      number: i,
      dueDate: getDueDate(input.startDate, i, input.paymentDay),
      principalCents: principal.toNumber(),
      interestCents: interest.toNumber(),
      adminFeeCents: fee.toNumber(),
      totalCents: principal.add(interest).add(fee).toNumber(),
      balanceAfterCents: remainingBalance.toNumber(),
    });
  }

  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), totalAmount.toNumber(), n);

  return {
    financedAmountCents: financedAmount.toNumber(),
    totalAmountCents: totalAmount.toNumber(),
    totalInterestCents: totalInterest.toNumber(),
    totalAdminFeeCents: adminFee.toNumber(),
    installments,
    tna,
    tea,
    cft,
    monthlyRate: monthlyRate.toNumber(),
  };
}

export function calculateFrenchSystem(input: AmortizationInput): AmortizationResult {
  const cashPrice = new Decimal(input.cashPriceCents);
  const adminFee = new Decimal(input.adminFeeCents);
  const monthlyRate = new Decimal(input.interestRate);
  const n = input.numInstallments;

  const financedAmount = cashPrice;
  
  let fixedPayment: Decimal;
  if (monthlyRate.isZero()) {
    fixedPayment = cashPrice.div(n);
  } else {
    const onePlusR = monthlyRate.add(1);
    const pow = onePlusR.pow(n);
    fixedPayment = cashPrice.mul(monthlyRate).mul(pow).div(pow.sub(1));
  }
  fixedPayment = fixedPayment.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;
  let totalInterest = new Decimal(0);

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    const interest = remainingBalance.mul(monthlyRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    let principal: Decimal;
    let payment: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      payment = principal.add(interest);
      fee = adminFee.sub(adminFeePerInstallment.mul(n - 1));
    } else {
      principal = fixedPayment.sub(interest);
      payment = fixedPayment;
      fee = adminFeePerInstallment;
    }

    totalInterest = totalInterest.add(interest);
    remainingBalance = remainingBalance.sub(principal);

    installments.push({
      number: i,
      dueDate: getDueDate(input.startDate, i, input.paymentDay),
      principalCents: principal.toNumber(),
      interestCents: interest.toNumber(),
      adminFeeCents: fee.toNumber(),
      totalCents: payment.add(fee).toNumber(),
      balanceAfterCents: Math.max(0, remainingBalance.toNumber()),
    });
  }

  const totalAmount = cashPrice.add(totalInterest).add(adminFee);
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), totalAmount.toNumber(), n);

  return {
    financedAmountCents: financedAmount.toNumber(),
    totalAmountCents: totalAmount.toNumber(),
    totalInterestCents: totalInterest.toNumber(),
    totalAdminFeeCents: adminFee.toNumber(),
    installments,
    tna,
    tea,
    cft,
    monthlyRate: monthlyRate.toNumber(),
  };
}

export function calculateZeroInterest(input: AmortizationInput): AmortizationResult {
  const cashPrice = new Decimal(input.cashPriceCents);
  const adminFee = new Decimal(input.adminFeeCents);
  const n = input.numInstallments;

  const installmentBase = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      fee = adminFee.sub(adminFeePerInstallment.mul(n - 1));
    } else {
      principal = installmentBase;
      fee = adminFeePerInstallment;
    }

    remainingBalance = remainingBalance.sub(principal);

    installments.push({
      number: i,
      dueDate: getDueDate(input.startDate, i, input.paymentDay),
      principalCents: principal.toNumber(),
      interestCents: 0,
      adminFeeCents: fee.toNumber(),
      totalCents: principal.add(fee).toNumber(),
      balanceAfterCents: remainingBalance.toNumber(),
    });
  }

  const totalAmount = cashPrice.add(adminFee);
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), totalAmount.toNumber(), n);

  return {
    financedAmountCents: cashPrice.toNumber(),
    totalAmountCents: totalAmount.toNumber(),
    totalInterestCents: 0,
    totalAdminFeeCents: adminFee.toNumber(),
    installments,
    tna,
    tea,
    cft,
    monthlyRate: 0,
  };
}

function calculateRates(
  principal: number,
  total: number,
  numPeriods: number
): { tna: number; tea: number; cft: number } {
  if (principal <= 0 || numPeriods <= 0) {
    return { tna: 0, tea: 0, cft: 0 };
  }

  const totalCost = total - principal;
  if (totalCost <= 0) {
    return { tna: 0, tea: 0, cft: 0 };
  }

  const monthlyPayment = new Decimal(total).div(numPeriods);
  const monthlyRate = findIRR(principal, monthlyPayment.toNumber(), numPeriods);
  
  const tna = new Decimal(monthlyRate).mul(12);
  const tea = new Decimal(1).add(monthlyRate).pow(12).sub(1);
  
  const cftMonthlyPayment = new Decimal(total).div(numPeriods);
  const cftMonthlyRate = findIRR(principal, cftMonthlyPayment.toNumber(), numPeriods);
  const cft = new Decimal(1).add(cftMonthlyRate).pow(12).sub(1);

  return {
    tna: tna.mul(100).toDecimalPlaces(4).toNumber(),
    tea: tea.mul(100).toDecimalPlaces(4).toNumber(),
    cft: cft.mul(100).toDecimalPlaces(4).toNumber(),
  };
}

function findIRR(principal: number, payment: number, periods: number, guess = 0.01): number {
  const maxIterations = 100;
  const tolerance = 1e-10;
  
  let rate = new Decimal(guess);
  
  for (let i = 0; i < maxIterations; i++) {
    let npv = new Decimal(-principal);
    let dnpv = new Decimal(0);
    
    for (let t = 1; t <= periods; t++) {
      const discountFactor = rate.add(1).pow(-t);
      npv = npv.add(new Decimal(payment).mul(discountFactor));
      dnpv = dnpv.sub(new Decimal(payment).mul(t).mul(rate.add(1).pow(-t - 1)));
    }
    
    if (dnpv.isZero()) break;
    
    const newRate = rate.sub(npv.div(dnpv));
    
    if (newRate.sub(rate).abs().lessThan(tolerance)) {
      return newRate.toNumber();
    }
    
    rate = newRate;
    if (rate.lessThan(0)) rate = new Decimal(0.0001);
    if (rate.greaterThan(1)) rate = new Decimal(0.9999);
  }
  
  return rate.toNumber();
}

export function calculateAmortization(input: AmortizationInput): AmortizationResult {
  switch (input.interestType) {
    case 'fixed_surcharge':
      return calculateFixedSurcharge(input);
    case 'direct_rate':
      return calculateDirectRate(input);
    case 'french':
      return calculateFrenchSystem(input);
    case 'zero_interest':
      return calculateZeroInterest(input);
    default:
      throw new Error(`Unknown interest type: ${input.interestType}`);
  }
}

export function calculatePenalty(
  outstandingCents: number,
  dueDate: Date,
  currentDate: Date,
  graceDays: number,
  dailyRate: number,
  cap: number
): number {
  const daysOverdue = Math.floor(
    (currentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
  ) - graceDays;

  if (daysOverdue <= 0) return 0;

  const penalty = new Decimal(outstandingCents).mul(dailyRate).mul(daysOverdue);
  const maxPenalty = new Decimal(outstandingCents).mul(cap);

  return Math.min(penalty.toNumber(), maxPenalty.toNumber());
}

export function formatCurrency(cents: number): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function parseLocalDate(dateString: string): Date {
  if (!dateString) return new Date();
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
