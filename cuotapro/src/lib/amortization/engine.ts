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

export class IRRConvergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IRRConvergenceError';
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function getDueDate(startDate: Date, installmentNumber: number, paymentDay?: number): Date {
  const date = addMonths(startDate, installmentNumber);
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
  
  // Use ROUND_DOWN for per-installment values to avoid exceeding total
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const principalPerInstallment = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const interestPerInstallment = totalInterest.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;
  let accumulatedFee = new Decimal(0);
  let accumulatedInterest = new Decimal(0);

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let interest: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      interest = totalInterest.sub(accumulatedInterest);
      fee = adminFee.sub(accumulatedFee);
    } else {
      principal = principalPerInstallment;
      interest = interestPerInstallment;
      fee = adminFeePerInstallment;
      accumulatedFee = accumulatedFee.add(fee);
      accumulatedInterest = accumulatedInterest.add(interest);
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
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), installments, n);

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

  // Use ROUND_DOWN for per-installment values to avoid exceeding total
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const principalPerInstallment = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const interestPerInstallment = totalInterest.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;
  let accumulatedFee = new Decimal(0);
  let accumulatedInterest = new Decimal(0);

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let interest: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      interest = totalInterest.sub(accumulatedInterest);
      fee = adminFee.sub(accumulatedFee);
    } else {
      principal = principalPerInstallment;
      interest = interestPerInstallment;
      fee = adminFeePerInstallment;
      accumulatedFee = accumulatedFee.add(fee);
      accumulatedInterest = accumulatedInterest.add(interest);
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

  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), installments, n);

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

  // Use ROUND_DOWN for per-installment admin fee to avoid exceeding total
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;
  let totalInterest = new Decimal(0);
  let accumulatedFee = new Decimal(0);

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    const interest = remainingBalance.mul(monthlyRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    let principal: Decimal;
    let payment: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      payment = principal.add(interest);
      fee = adminFee.sub(accumulatedFee);
    } else {
      principal = fixedPayment.sub(interest);
      payment = fixedPayment;
      fee = adminFeePerInstallment;
      accumulatedFee = accumulatedFee.add(fee);
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
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), installments, n);

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

  // Use ROUND_DOWN for per-installment values to avoid exceeding total
  const installmentBase = cashPrice.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  const adminFeePerInstallment = adminFee.div(n).toDecimalPlaces(0, Decimal.ROUND_DOWN);

  const installments: InstallmentSchedule[] = [];
  let remainingBalance = cashPrice;
  let accumulatedFee = new Decimal(0);

  for (let i = 1; i <= n; i++) {
    const isLast = i === n;
    let principal: Decimal;
    let fee: Decimal;

    if (isLast) {
      principal = remainingBalance;
      fee = adminFee.sub(accumulatedFee);
    } else {
      principal = installmentBase;
      fee = adminFeePerInstallment;
      accumulatedFee = accumulatedFee.add(fee);
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
  const { tna, tea, cft } = calculateRates(cashPrice.toNumber(), installments, n);

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

/**
 * Calculate TNA, TEA, and CFT separately:
 * - TEA: Based on cashflows WITHOUT admin fee (pure financing cost)
 * - CFT: Based on real cashflows WITH admin fee (total cost to consumer per Ley 24.240)
 */
function calculateRates(
  principal: number,
  installments: InstallmentSchedule[],
  numPeriods: number
): { tna: number; tea: number; cft: number } {
  if (principal <= 0 || numPeriods <= 0) {
    return { tna: 0, tea: 0, cft: 0 };
  }

  // TEA: Calculate using payments WITHOUT admin fee (principal + interest only)
  const paymentsWithoutFee = installments.map(inst => inst.principalCents + inst.interestCents);
  const totalWithoutFee = paymentsWithoutFee.reduce((sum, p) => sum + p, 0);
  
  if (totalWithoutFee <= principal) {
    return { tna: 0, tea: 0, cft: 0 };
  }

  const teaMonthlyRate = findIRR(principal, paymentsWithoutFee);
  const tna = new Decimal(teaMonthlyRate).mul(12);
  const tea = new Decimal(1).add(teaMonthlyRate).pow(12).sub(1);

  // CFT: Calculate using REAL payments WITH admin fee (total cost)
  const paymentsWithFee = installments.map(inst => inst.totalCents);
  const totalWithFee = paymentsWithFee.reduce((sum, p) => sum + p, 0);
  
  let cft: Decimal;
  if (totalWithFee <= principal) {
    cft = new Decimal(0);
  } else {
    const cftMonthlyRate = findIRR(principal, paymentsWithFee);
    cft = new Decimal(1).add(cftMonthlyRate).pow(12).sub(1);
  }

  return {
    tna: tna.mul(100).toDecimalPlaces(4).toNumber(),
    tea: tea.mul(100).toDecimalPlaces(4).toNumber(),
    cft: cft.mul(100).toDecimalPlaces(4).toNumber(),
  };
}

/**
 * Find IRR using bisection method with Newton-Raphson refinement.
 * Throws IRRConvergenceError if no convergence after max iterations.
 * 
 * @param principal - Initial loan amount (negative cashflow at t=0)
 * @param payments - Array of payment amounts at each period
 * @returns Monthly rate (not annualized)
 */
function findIRR(principal: number, payments: number[]): number {
  const maxIterations = 200;
  const tolerance = 1e-10;
  const periods = payments.length;

  // NPV function for a given rate
  const npv = (rate: Decimal): Decimal => {
    let result = new Decimal(-principal);
    for (let t = 1; t <= periods; t++) {
      const discountFactor = rate.add(1).pow(-t);
      result = result.add(new Decimal(payments[t - 1]).mul(discountFactor));
    }
    return result;
  };

  // Derivative of NPV for Newton-Raphson
  const dnpv = (rate: Decimal): Decimal => {
    let result = new Decimal(0);
    for (let t = 1; t <= periods; t++) {
      result = result.sub(new Decimal(payments[t - 1]).mul(t).mul(rate.add(1).pow(-t - 1)));
    }
    return result;
  };

  // Phase 1: Bisection to find rough bounds
  let lower = new Decimal(-0.99); // Allow negative rates (rare but possible)
  let upper = new Decimal(10); // 1000% monthly (extreme upper bound, no artificial cap)
  
  let npvLower = npv(lower);
  let npvUpper = npv(upper);
  
  // If both have same sign, expand search
  let expansionAttempts = 0;
  while (npvLower.mul(npvUpper).greaterThan(0) && expansionAttempts < 20) {
    if (npvLower.greaterThan(0)) {
      lower = lower.mul(2);
    } else {
      upper = upper.mul(2);
    }
    npvLower = npv(lower);
    npvUpper = npv(upper);
    expansionAttempts++;
  }

  if (npvLower.mul(npvUpper).greaterThan(0)) {
    throw new IRRConvergenceError(
      `IRR does not converge: no root found between ${lower.toNumber()} and ${upper.toNumber()}`
    );
  }

  // Bisection iterations to narrow down
  let mid = lower.add(upper).div(2);
  for (let i = 0; i < 50; i++) {
    mid = lower.add(upper).div(2);
    const npvMid = npv(mid);
    
    if (npvMid.abs().lessThan(tolerance)) {
      return mid.toNumber();
    }
    
    if (npvLower.mul(npvMid).lessThan(0)) {
      upper = mid;
      npvUpper = npvMid;
    } else {
      lower = mid;
      npvLower = npvMid;
    }
  }

  // Phase 2: Newton-Raphson refinement from bisection result
  let rate = mid;
  for (let i = 0; i < maxIterations; i++) {
    const npvValue = npv(rate);
    const dnpvValue = dnpv(rate);
    
    if (npvValue.abs().lessThan(tolerance)) {
      return rate.toNumber();
    }
    
    if (dnpvValue.isZero()) {
      break; // Derivative is zero, can't continue Newton
    }
    
    const newRate = rate.sub(npvValue.div(dnpvValue));
    
    if (newRate.sub(rate).abs().lessThan(tolerance)) {
      return newRate.toNumber();
    }
    
    // Keep within reasonable bounds but don't cap at 0.9999
    if (newRate.lessThan(-0.99)) {
      rate = new Decimal(-0.99);
    } else if (newRate.greaterThan(100)) {
      rate = new Decimal(100);
    } else {
      rate = newRate;
    }
  }
  
  throw new IRRConvergenceError(
    `IRR did not converge after ${maxIterations} iterations. Last rate: ${rate.toNumber()}`
  );
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

/**
 * Calculate penalty using ROUND_HALF_UP to centavo.
 * Server (SQL) is the source of truth - this function mirrors the SQL logic.
 * 
 * @param outstandingCents - Outstanding amount in cents
 * @param dueDate - Due date of the installment
 * @param currentDate - Current date for calculation
 * @param graceDays - Number of grace days before penalty starts
 * @param dailyRate - Daily penalty rate (e.g., 0.001 for 0.1%)
 * @param cap - Maximum penalty as fraction of outstanding (e.g., 0.30 for 30%)
 * @returns Penalty amount in cents (ROUND_HALF_UP to integer)
 */
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

  const outstanding = new Decimal(outstandingCents);
  const penalty = outstanding.mul(dailyRate).mul(daysOverdue);
  const maxPenalty = outstanding.mul(cap);

  // ROUND_HALF_UP to centavo (integer)
  const finalPenalty = Decimal.min(penalty, maxPenalty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  return finalPenalty.toNumber();
}

/**
 * Payment allocation order for partial payments:
 * 1. Penalty (punitorios)
 * 2. Interest (intereses)
 * 3. Admin fee (cargo administrativo)
 * 4. Principal (capital)
 * 
 * Returns the allocation breakdown.
 */
export interface PaymentAllocation {
  penaltyAppliedCents: number;
  interestAppliedCents: number;
  adminFeeAppliedCents: number;
  principalAppliedCents: number;
  remainingCents: number;
}

export function allocatePayment(
  paymentCents: number,
  outstandingPenaltyCents: number,
  outstandingInterestCents: number,
  outstandingAdminFeeCents: number,
  outstandingPrincipalCents: number
): PaymentAllocation {
  let remaining = new Decimal(paymentCents);
  
  // 1. Penalty first
  const penaltyApplied = Decimal.min(remaining, new Decimal(outstandingPenaltyCents));
  remaining = remaining.sub(penaltyApplied);
  
  // 2. Interest
  const interestApplied = Decimal.min(remaining, new Decimal(outstandingInterestCents));
  remaining = remaining.sub(interestApplied);
  
  // 3. Admin fee
  const adminFeeApplied = Decimal.min(remaining, new Decimal(outstandingAdminFeeCents));
  remaining = remaining.sub(adminFeeApplied);
  
  // 4. Principal
  const principalApplied = Decimal.min(remaining, new Decimal(outstandingPrincipalCents));
  remaining = remaining.sub(principalApplied);

  return {
    penaltyAppliedCents: penaltyApplied.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    interestAppliedCents: interestApplied.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    adminFeeAppliedCents: adminFeeApplied.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    principalAppliedCents: principalApplied.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    remainingCents: remaining.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  };
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
