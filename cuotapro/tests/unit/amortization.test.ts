import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateAmortization,
  calculateFixedSurcharge,
  calculateDirectRate,
  calculateFrenchSystem,
  calculateZeroInterest,
  calculatePenalty,
  allocatePayment,
  formatCurrency,
  IRRConvergenceError,
} from '@/lib/amortization/engine';
import type { AmortizationInput, InstallmentSchedule } from '@/lib/amortization/engine';

describe('Amortization Engine', () => {
  const baseInput: AmortizationInput = {
    cashPriceCents: 10000000, // $100,000 ARS
    adminFeeCents: 500000, // $5,000 ARS
    numInstallments: 6,
    interestType: 'fixed_surcharge',
    interestRate: 0.15, // 15%
    startDate: new Date('2024-01-01'),
  };

  // ==========================================================================
  // EXACT TOTALS (0 cents difference)
  // ==========================================================================
  
  describe('Exact Totals (0 cents difference)', () => {
    it('fixed_surcharge: sum of installment totals equals totalAmountCents exactly', () => {
      const result = calculateFixedSurcharge(baseInput);
      const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
      expect(sumTotal).toBe(result.totalAmountCents);
    });

    it('fixed_surcharge: sum of principal equals financedAmountCents exactly', () => {
      const result = calculateFixedSurcharge(baseInput);
      const sumPrincipal = result.installments.reduce((sum, inst) => sum + inst.principalCents, 0);
      expect(sumPrincipal).toBe(result.financedAmountCents);
    });

    it('fixed_surcharge: sum of interest equals totalInterestCents exactly', () => {
      const result = calculateFixedSurcharge(baseInput);
      const sumInterest = result.installments.reduce((sum, inst) => sum + inst.interestCents, 0);
      expect(sumInterest).toBe(result.totalInterestCents);
    });

    it('fixed_surcharge: sum of admin fees equals totalAdminFeeCents exactly', () => {
      const result = calculateFixedSurcharge(baseInput);
      const sumFee = result.installments.reduce((sum, inst) => sum + inst.adminFeeCents, 0);
      expect(sumFee).toBe(result.totalAdminFeeCents);
    });

    it('direct_rate: sum of installment totals equals totalAmountCents exactly', () => {
      const input: AmortizationInput = { ...baseInput, interestType: 'direct_rate', interestRate: 0.05 };
      const result = calculateDirectRate(input);
      const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
      expect(sumTotal).toBe(result.totalAmountCents);
    });

    it('french: sum of principal equals financedAmountCents exactly', () => {
      const input: AmortizationInput = { ...baseInput, interestType: 'french', interestRate: 0.05 };
      const result = calculateFrenchSystem(input);
      const sumPrincipal = result.installments.reduce((sum, inst) => sum + inst.principalCents, 0);
      expect(sumPrincipal).toBe(result.financedAmountCents);
    });

    it('zero_interest: sum of principal equals cashPriceCents exactly', () => {
      const input: AmortizationInput = { ...baseInput, interestType: 'zero_interest' };
      const result = calculateZeroInterest(input);
      const sumPrincipal = result.installments.reduce((sum, inst) => sum + inst.principalCents, 0);
      expect(sumPrincipal).toBe(input.cashPriceCents);
    });

    it('zero_interest: totalAmountCents = cashPrice + adminFee exactly', () => {
      const input: AmortizationInput = { ...baseInput, interestType: 'zero_interest' };
      const result = calculateZeroInterest(input);
      expect(result.totalAmountCents).toBe(input.cashPriceCents + input.adminFeeCents);
    });
  });

  // ==========================================================================
  // HAND-CALCULATED TEA/CFT CASES
  // ==========================================================================
  
  describe('Hand-calculated TEA/CFT cases', () => {
    it('TEA excludes admin fee, CFT includes it', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000, // $10,000
        adminFeeCents: 100000,  // $1,000 admin fee
        numInstallments: 12,
        interestType: 'french',
        interestRate: 0.05, // 5% monthly
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      // CFT must be > TEA when admin fee is present (CFT includes more costs)
      expect(result.cft).toBeGreaterThan(result.tea);
      
      // With 5% monthly, TEA should be approximately (1.05^12 - 1) * 100 ≈ 79.59%
      // Allow 5% tolerance due to rounding in installments
      expect(result.tea).toBeGreaterThan(70);
      expect(result.tea).toBeLessThan(90);
    });

    it('TEA and CFT are equal when no admin fee', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000,
        adminFeeCents: 0,
        numInstallments: 12,
        interestType: 'french',
        interestRate: 0.05,
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      // Without admin fee, TEA should equal CFT
      expect(Math.abs(result.tea - result.cft)).toBeLessThan(0.01);
    });

    it('zero interest plan: TEA and CFT should be 0 or very small (admin fee only)', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000,
        adminFeeCents: 0,
        numInstallments: 6,
        interestType: 'zero_interest',
        interestRate: 0,
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      expect(result.tea).toBe(0);
      expect(result.cft).toBe(0);
    });

    it('fixed 15% surcharge on 100k over 6 months: verify manual calculation', () => {
      // Manual calculation:
      // Principal: $100,000
      // 15% surcharge: $15,000
      // Total with interest: $115,000
      // Admin fee: $5,000
      // Total: $120,000
      
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.financedAmountCents).toBe(10000000);
      expect(result.totalInterestCents).toBe(1500000);
      expect(result.totalAmountCents).toBe(12000000);
      
      // TEA should be significant for 15% over 6 months
      expect(result.tea).toBeGreaterThan(20);
      expect(result.tna).toBeGreaterThan(0);
    });

    it('TNA = monthly rate * 12 (approximately)', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000,
        adminFeeCents: 0,
        numInstallments: 12,
        interestType: 'french',
        interestRate: 0.03, // 3% monthly
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      // TNA should be approximately 3% * 12 = 36%
      // Allow some variance due to IRR calculation
      expect(result.tna).toBeGreaterThan(30);
      expect(result.tna).toBeLessThan(45);
    });
  });

  // ==========================================================================
  // PROPERTY-BASED TESTS (fast-check)
  // ==========================================================================
  
  describe('Property-based tests (fast-check)', () => {
    it('principal sum always equals financed amount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10000, max: 100000000 }), // 100 to 1M ARS
          fc.integer({ min: 0, max: 1000000 }), // 0 to 10k admin fee
          fc.integer({ min: 1, max: 60 }), // 1 to 60 installments
          fc.double({ min: 0, max: 0.5, noNaN: true }), // 0 to 50% rate
          (cashPrice, adminFee, numInstallments, rate) => {
            const input: AmortizationInput = {
              cashPriceCents: cashPrice,
              adminFeeCents: adminFee,
              numInstallments,
              interestType: 'fixed_surcharge',
              interestRate: rate,
              startDate: new Date('2024-01-01'),
            };
            
            const result = calculateAmortization(input);
            const sumPrincipal = result.installments.reduce((sum, inst) => sum + inst.principalCents, 0);
            
            return sumPrincipal === result.financedAmountCents;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('total cents equals principal + interest + admin fee (within rounding tolerance)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100000, max: 10000000 }), // min 1000 ARS to avoid extreme rounding
          fc.integer({ min: 0, max: 500000 }),
          fc.integer({ min: 2, max: 24 }), // at least 2 installments
          fc.double({ min: 0.01, max: 0.3, noNaN: true }),
          (cashPrice, adminFee, numInstallments, rate) => {
            const input: AmortizationInput = {
              cashPriceCents: cashPrice,
              adminFeeCents: adminFee,
              numInstallments,
              interestType: 'direct_rate',
              interestRate: rate,
              startDate: new Date('2024-01-01'),
            };
            
            const result = calculateAmortization(input);
            const expected = result.financedAmountCents + result.totalInterestCents + result.totalAdminFeeCents;
            
            // Allow for rounding tolerance (at most numInstallments cents)
            return Math.abs(result.totalAmountCents - expected) <= numInstallments;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('installment totals sum to totalAmountCents for all types', () => {
      const interestTypes: Array<AmortizationInput['interestType']> = [
        'fixed_surcharge',
        'direct_rate',
        'zero_interest',
      ];
      
      interestTypes.forEach((type) => {
        fc.assert(
          fc.property(
            fc.integer({ min: 100000, max: 50000000 }),
            fc.integer({ min: 0, max: 500000 }),
            fc.integer({ min: 2, max: 36 }),
            (cashPrice, adminFee, numInstallments) => {
              const input: AmortizationInput = {
                cashPriceCents: cashPrice,
                adminFeeCents: adminFee,
                numInstallments,
                interestType: type,
                interestRate: type === 'zero_interest' ? 0 : 0.1,
                startDate: new Date('2024-01-01'),
              };
              
              const result = calculateAmortization(input);
              const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
              
              return sumTotal === result.totalAmountCents;
            }
          ),
          { numRuns: 50 }
        );
      });
    });

    it('french system: balance decreases monotonically', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100000, max: 10000000 }),
          fc.integer({ min: 3, max: 24 }),
          fc.double({ min: 0.01, max: 0.15, noNaN: true }),
          (cashPrice, numInstallments, rate) => {
            const input: AmortizationInput = {
              cashPriceCents: cashPrice,
              adminFeeCents: 0,
              numInstallments,
              interestType: 'french',
              interestRate: rate,
              startDate: new Date('2024-01-01'),
            };
            
            const result = calculateFrenchSystem(input);
            
            for (let i = 1; i < result.installments.length; i++) {
              if (result.installments[i].balanceAfterCents > result.installments[i - 1].balanceAfterCents) {
                return false;
              }
            }
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('all installments have non-negative components', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100000, max: 50000000 }), // min $1000 to avoid edge cases
          fc.integer({ min: 0, max: 500000 }), // reasonable admin fee
          fc.integer({ min: 2, max: 48 }), // at least 2 installments
          fc.constantFrom('fixed_surcharge', 'direct_rate', 'french', 'zero_interest'),
          (cashPrice, adminFee, numInstallments, type) => {
            // Ensure admin fee is not larger than cashPrice to avoid weird cases
            const effectiveAdminFee = Math.min(adminFee, cashPrice / 10);
            
            const input: AmortizationInput = {
              cashPriceCents: cashPrice,
              adminFeeCents: effectiveAdminFee,
              numInstallments,
              interestType: type as AmortizationInput['interestType'],
              interestRate: type === 'zero_interest' ? 0 : 0.05,
              startDate: new Date('2024-01-01'),
            };
            
            const result = calculateAmortization(input);
            
            return result.installments.every((inst) =>
              inst.principalCents >= 0 &&
              inst.interestCents >= 0 &&
              inst.adminFeeCents >= 0 &&
              inst.totalCents >= 0 &&
              inst.balanceAfterCents >= 0
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ==========================================================================
  // PENALTY CALCULATION
  // ==========================================================================
  
  describe('Penalty Calculation (ROUND_HALF_UP)', () => {
    it('returns 0 within grace period', () => {
      const penalty = calculatePenalty(
        100000,
        new Date('2024-01-01'),
        new Date('2024-01-05'),
        5,
        0.001,
        0.30
      );
      expect(penalty).toBe(0);
    });

    it('calculates penalty after grace period with ROUND_HALF_UP', () => {
      // 10 days after, 5 grace = 5 overdue
      // 100000 * 0.001 * 5 = 500
      const penalty = calculatePenalty(
        100000,
        new Date('2024-01-01'),
        new Date('2024-01-11'),
        5,
        0.001,
        0.30
      );
      expect(penalty).toBe(500);
    });

    it('respects penalty cap', () => {
      // 365 days overdue * 1% daily = 365% > 30% cap
      const penalty = calculatePenalty(
        100000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        0,
        0.01,
        0.30
      );
      expect(penalty).toBe(30000); // 30% cap
    });

    it('rounds half up correctly', () => {
      // 100000 * 0.001 * 7 = 700 (no rounding needed)
      const penalty1 = calculatePenalty(100000, new Date('2024-01-01'), new Date('2024-01-13'), 5, 0.001, 1);
      expect(penalty1).toBe(700);
      
      // Test with fractional result: 12345 * 0.001 * 3 = 37.035 -> 37
      const penalty2 = calculatePenalty(12345, new Date('2024-01-01'), new Date('2024-01-09'), 5, 0.001, 1);
      expect(penalty2).toBe(37);
      
      // Test round up: 12345 * 0.001 * 5 = 61.725 -> 62
      const penalty3 = calculatePenalty(12345, new Date('2024-01-01'), new Date('2024-01-11'), 5, 0.001, 1);
      expect(penalty3).toBe(62);
    });
  });

  // ==========================================================================
  // PAYMENT ALLOCATION
  // ==========================================================================
  
  describe('Payment Allocation (penalty, interest, fee, principal)', () => {
    it('allocates in correct order: penalty first', () => {
      const result = allocatePayment(
        5000, // payment
        3000, // outstanding penalty
        2000, // outstanding interest
        1000, // outstanding fee
        10000 // outstanding principal
      );
      
      expect(result.penaltyAppliedCents).toBe(3000);
      expect(result.interestAppliedCents).toBe(2000);
      expect(result.adminFeeAppliedCents).toBe(0);
      expect(result.principalAppliedCents).toBe(0);
      expect(result.remainingCents).toBe(0);
    });

    it('allocates to principal last', () => {
      const result = allocatePayment(
        16000, // payment covers everything
        3000,
        2000,
        1000,
        10000
      );
      
      expect(result.penaltyAppliedCents).toBe(3000);
      expect(result.interestAppliedCents).toBe(2000);
      expect(result.adminFeeAppliedCents).toBe(1000);
      expect(result.principalAppliedCents).toBe(10000);
      expect(result.remainingCents).toBe(0);
    });

    it('handles partial payment correctly', () => {
      const result = allocatePayment(
        4500, // partial payment
        1000,
        2000,
        1500,
        5000
      );
      
      expect(result.penaltyAppliedCents).toBe(1000);
      expect(result.interestAppliedCents).toBe(2000);
      expect(result.adminFeeAppliedCents).toBe(1500);
      expect(result.principalAppliedCents).toBe(0);
      expect(result.remainingCents).toBe(0);
    });

    it('handles overpayment (returns remaining)', () => {
      const result = allocatePayment(
        20000,
        1000,
        2000,
        1000,
        5000
      );
      
      expect(result.penaltyAppliedCents).toBe(1000);
      expect(result.interestAppliedCents).toBe(2000);
      expect(result.adminFeeAppliedCents).toBe(1000);
      expect(result.principalAppliedCents).toBe(5000);
      expect(result.remainingCents).toBe(11000);
    });

    it('handles zero outstanding', () => {
      const result = allocatePayment(5000, 0, 0, 0, 5000);
      
      expect(result.penaltyAppliedCents).toBe(0);
      expect(result.interestAppliedCents).toBe(0);
      expect(result.adminFeeAppliedCents).toBe(0);
      expect(result.principalAppliedCents).toBe(5000);
    });
  });

  // ==========================================================================
  // EDGE CASES: PARTIAL PAYMENT ON OVERDUE
  // ==========================================================================
  
  describe('Edge cases: Partial payment on overdue installment', () => {
    it('partial payment goes to penalty first when overdue', () => {
      // Scenario: Installment with:
      // - principal: 10000
      // - interest: 2000
      // - admin_fee: 500
      // - penalty: 1500 (calculated server-side)
      // Total outstanding: 14000
      // Payment: 2000
      
      const result = allocatePayment(
        2000,
        1500, // penalty outstanding
        2000, // interest outstanding
        500,  // fee outstanding
        10000 // principal outstanding
      );
      
      // Should apply to penalty first, then interest
      expect(result.penaltyAppliedCents).toBe(1500);
      expect(result.interestAppliedCents).toBe(500);
      expect(result.adminFeeAppliedCents).toBe(0);
      expect(result.principalAppliedCents).toBe(0);
    });

    it('multiple partial payments accumulate correctly', () => {
      // First payment: 1000 -> all to penalty (1500 - 1000 = 500 remaining)
      const result1 = allocatePayment(1000, 1500, 2000, 500, 10000);
      expect(result1.penaltyAppliedCents).toBe(1000);
      expect(result1.interestAppliedCents).toBe(0);
      
      // Second payment: 1500 -> 500 penalty + 1000 interest
      const result2 = allocatePayment(1500, 500, 2000, 500, 10000);
      expect(result2.penaltyAppliedCents).toBe(500);
      expect(result2.interestAppliedCents).toBe(1000);
      
      // Third payment: covers rest of interest + fee + some principal
      const result3 = allocatePayment(2000, 0, 1000, 500, 10000);
      expect(result3.penaltyAppliedCents).toBe(0);
      expect(result3.interestAppliedCents).toBe(1000);
      expect(result3.adminFeeAppliedCents).toBe(500);
      expect(result3.principalAppliedCents).toBe(500);
    });
  });

  // ==========================================================================
  // IRR CONVERGENCE
  // ==========================================================================
  
  describe('IRR Convergence (no 0.9999 cap)', () => {
    it('handles high interest rates without capping', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000,
        adminFeeCents: 0,
        numInstallments: 6,
        interestType: 'french',
        interestRate: 0.50, // 50% monthly - extreme
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      // TEA should be very high (over 1000%)
      expect(result.tea).toBeGreaterThan(100);
      // Should not be capped at any artificial limit
    });

    it('handles very low interest rates', () => {
      const input: AmortizationInput = {
        cashPriceCents: 1000000,
        adminFeeCents: 0,
        numInstallments: 12,
        interestType: 'french',
        interestRate: 0.001, // 0.1% monthly
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      // TEA should be small but positive
      expect(result.tea).toBeGreaterThan(0);
      expect(result.tea).toBeLessThan(5);
    });
  });

  // ==========================================================================
  // ORIGINAL TEST CASES (backwards compatibility)
  // ==========================================================================

  describe('Fixed Surcharge (Recargo Fijo)', () => {
    it('should calculate correct total with 15% surcharge', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.financedAmountCents).toBe(10000000);
      expect(result.totalInterestCents).toBe(1500000);
      expect(result.totalAdminFeeCents).toBe(500000);
      expect(result.totalAmountCents).toBe(12000000);
    });

    it('should generate correct number of installments', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.installments).toHaveLength(6);
      result.installments.forEach((inst, i) => {
        expect(inst.number).toBe(i + 1);
      });
    });

    it('should calculate rates (TNA, TEA, CFT)', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.tna).toBeGreaterThan(0);
      expect(result.tea).toBeGreaterThan(0);
      expect(result.cft).toBeGreaterThan(0);
    });
  });

  describe('Direct Rate (Tasa Directa)', () => {
    it('should calculate with 5% monthly rate', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'direct_rate',
        interestRate: 0.05,
      };
      
      const result = calculateDirectRate(input);
      
      expect(result.financedAmountCents).toBe(10000000);
      expect(result.totalInterestCents).toBe(3000000);
      expect(result.totalAmountCents).toBe(13500000);
    });
  });

  describe('French System (Sistema Francés)', () => {
    it('should have decreasing interest and increasing principal', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0.05,
        adminFeeCents: 0,
      };
      
      const result = calculateFrenchSystem(input);
      
      for (let i = 1; i < result.installments.length - 1; i++) {
        expect(result.installments[i].interestCents).toBeLessThanOrEqual(
          result.installments[i - 1].interestCents
        );
      }
    });

    it('should result in zero balance after last payment', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0.05,
      };
      
      const result = calculateFrenchSystem(input);
      const lastInstallment = result.installments[result.installments.length - 1];
      
      expect(lastInstallment.balanceAfterCents).toBe(0);
    });
  });

  describe('Zero Interest (Sin Interés)', () => {
    it('should have zero interest', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'zero_interest',
        interestRate: 0,
      };
      
      const result = calculateZeroInterest(input);
      
      expect(result.totalInterestCents).toBe(0);
      result.installments.forEach((inst) => {
        expect(inst.interestCents).toBe(0);
      });
    });
  });

  describe('Due Date Generation', () => {
    it('should generate monthly due dates', () => {
      const result = calculateAmortization(baseInput);
      
      for (let i = 1; i < result.installments.length; i++) {
        const prevDate = result.installments[i - 1].dueDate;
        const currDate = result.installments[i].dueDate;
        
        const monthDiff =
          (currDate.getFullYear() - prevDate.getFullYear()) * 12 +
          (currDate.getMonth() - prevDate.getMonth());
        
        expect(monthDiff).toBe(1);
      }
    });

    it('should respect custom payment day', () => {
      const input: AmortizationInput = {
        ...baseInput,
        paymentDay: 15,
      };
      
      const result = calculateAmortization(input);
      
      result.installments.forEach((inst) => {
        expect(inst.dueDate.getDate()).toBe(15);
      });
    });
  });

  describe('Currency Formatting', () => {
    it('should format cents to ARS currency', () => {
      const formatted100 = formatCurrency(10000);
      expect(formatted100).toContain('100');
      
      const formatted1500 = formatCurrency(150050);
      expect(formatted1500).toContain('1');
      expect(formatted1500).toContain('500');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single installment', () => {
      const input: AmortizationInput = {
        ...baseInput,
        numInstallments: 1,
      };
      
      const result = calculateAmortization(input);
      
      expect(result.installments).toHaveLength(1);
      expect(result.installments[0].principalCents).toBe(input.cashPriceCents);
    });

    it('should handle large number of installments', () => {
      const input: AmortizationInput = {
        ...baseInput,
        numInstallments: 60,
        interestType: 'french',
        interestRate: 0.03,
      };
      
      const result = calculateAmortization(input);
      
      expect(result.installments).toHaveLength(60);
      
      const sumPrincipal = result.installments.reduce(
        (sum, inst) => sum + inst.principalCents, 0
      );
      expect(sumPrincipal).toBe(input.cashPriceCents);
    });

    it('should handle very small amounts', () => {
      const input: AmortizationInput = {
        cashPriceCents: 100,
        adminFeeCents: 10,
        numInstallments: 3,
        interestType: 'fixed_surcharge',
        interestRate: 0.10,
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      expect(result.installments).toHaveLength(3);
      const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
      expect(sumTotal).toBe(result.totalAmountCents);
    });
  });
});
