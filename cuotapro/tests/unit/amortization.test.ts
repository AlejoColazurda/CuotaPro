import { describe, it, expect } from 'vitest';
import {
  calculateAmortization,
  calculateFixedSurcharge,
  calculateDirectRate,
  calculateFrenchSystem,
  calculateZeroInterest,
  calculatePenalty,
  formatCurrency,
} from '@/lib/amortization/engine';
import type { AmortizationInput } from '@/lib/amortization/engine';

describe('Amortization Engine', () => {
  const baseInput: AmortizationInput = {
    cashPriceCents: 10000000, // $100,000 ARS
    adminFeeCents: 500000, // $5,000 ARS
    numInstallments: 6,
    interestType: 'fixed_surcharge',
    interestRate: 0.15, // 15%
    startDate: new Date('2024-01-01'),
  };

  describe('Fixed Surcharge (Recargo Fijo)', () => {
    it('should calculate correct total with 15% surcharge', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.financedAmountCents).toBe(10000000);
      expect(result.totalInterestCents).toBe(1500000); // 15% of 100,000
      expect(result.totalAdminFeeCents).toBe(500000);
      expect(result.totalAmountCents).toBe(12000000); // 100,000 + 15,000 + 5,000
    });

    it('should generate correct number of installments', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.installments).toHaveLength(6);
      result.installments.forEach((inst, i) => {
        expect(inst.number).toBe(i + 1);
      });
    });

    it('should have installments sum to total', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
      expect(Math.abs(sumTotal - result.totalAmountCents)).toBeLessThanOrEqual(result.installments.length);
    });

    it('should have principal sum to financed amount', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      const sumPrincipal = result.installments.reduce((sum, inst) => sum + inst.principalCents, 0);
      expect(sumPrincipal).toBe(result.financedAmountCents);
    });

    it('should have interest sum to total interest', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      const sumInterest = result.installments.reduce((sum, inst) => sum + inst.interestCents, 0);
      expect(sumInterest).toBe(result.totalInterestCents);
    });

    it('should calculate rates (TNA, TEA, CFT)', () => {
      const result = calculateFixedSurcharge(baseInput);
      
      expect(result.tna).toBeGreaterThan(0);
      expect(result.tea).toBeGreaterThan(0);
      expect(result.cft).toBeGreaterThan(0);
      expect(result.tea).toBeGreaterThan(result.tna);
    });
  });

  describe('Direct Rate (Tasa Directa)', () => {
    it('should calculate with 5% monthly rate', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'direct_rate',
        interestRate: 0.05, // 5% monthly
      };
      
      const result = calculateDirectRate(input);
      
      expect(result.financedAmountCents).toBe(10000000);
      expect(result.totalInterestCents).toBe(3000000); // 5% * 6 months * 100,000
      expect(result.totalAmountCents).toBe(13500000); // 100,000 + 30,000 + 5,000
    });

    it('should have equal installments', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'direct_rate',
        interestRate: 0.05,
        adminFeeCents: 0,
      };
      
      const result = calculateDirectRate(input);
      const firstInstallment = result.installments[0].totalCents;
      
      result.installments.slice(0, -1).forEach((inst) => {
        expect(Math.abs(inst.totalCents - firstInstallment)).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('French System (Sistema Francés)', () => {
    it('should have decreasing interest and increasing principal', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0.05, // 5% monthly
        adminFeeCents: 0,
      };
      
      const result = calculateFrenchSystem(input);
      
      for (let i = 1; i < result.installments.length - 1; i++) {
        expect(result.installments[i].interestCents).toBeLessThanOrEqual(
          result.installments[i - 1].interestCents
        );
        expect(result.installments[i].principalCents).toBeGreaterThanOrEqual(
          result.installments[i - 1].principalCents
        );
      }
    });

    it('should have nearly equal total payments (cuota fija)', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0.05,
        adminFeeCents: 0,
      };
      
      const result = calculateFrenchSystem(input);
      const avgPayment = result.totalAmountCents / input.numInstallments;
      
      result.installments.slice(0, -1).forEach((inst) => {
        const diff = Math.abs(inst.totalCents - avgPayment);
        expect(diff).toBeLessThan(avgPayment * 0.05);
      });
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

    it('should handle 0% rate (same as zero interest)', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0,
      };
      
      const result = calculateFrenchSystem(input);
      
      expect(result.totalInterestCents).toBe(0);
      expect(result.totalAmountCents).toBe(baseInput.cashPriceCents + baseInput.adminFeeCents);
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

    it('should only include cash price and admin fee', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'zero_interest',
      };
      
      const result = calculateZeroInterest(input);
      
      expect(result.totalAmountCents).toBe(
        input.cashPriceCents + input.adminFeeCents
      );
    });

    it('should have equal principal payments', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'zero_interest',
        adminFeeCents: 0,
      };
      
      const result = calculateZeroInterest(input);
      const expectedPayment = Math.round(input.cashPriceCents / input.numInstallments);
      
      result.installments.slice(0, -1).forEach((inst) => {
        expect(Math.abs(inst.principalCents - expectedPayment)).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('calculateAmortization dispatcher', () => {
    it('should dispatch to correct method based on interest type', () => {
      const types: Array<AmortizationInput['interestType']> = [
        'fixed_surcharge',
        'direct_rate',
        'french',
        'zero_interest',
      ];
      
      types.forEach((type) => {
        const input: AmortizationInput = {
          ...baseInput,
          interestType: type,
          interestRate: type === 'zero_interest' ? 0 : 0.1,
        };
        
        const result = calculateAmortization(input);
        expect(result.installments).toHaveLength(6);
      });
    });
  });

  describe('CFT Calculation (Costo Financiero Total)', () => {
    it('should include admin fee in CFT', () => {
      const inputWithFee: AmortizationInput = {
        ...baseInput,
        adminFeeCents: 1000000, // $10,000
      };
      
      const inputWithoutFee: AmortizationInput = {
        ...baseInput,
        adminFeeCents: 0,
      };
      
      const resultWithFee = calculateAmortization(inputWithFee);
      const resultWithoutFee = calculateAmortization(inputWithoutFee);
      
      expect(resultWithFee.cft).toBeGreaterThan(resultWithoutFee.cft);
    });

    it('should have CFT >= TEA when admin fee present', () => {
      const result = calculateAmortization(baseInput);
      
      expect(result.cft).toBeGreaterThanOrEqual(result.tea);
    });

    it('should calculate positive CFT for financed plans', () => {
      const input: AmortizationInput = {
        cashPriceCents: 50000000, // $500,000
        adminFeeCents: 2500000, // $25,000
        numInstallments: 12,
        interestType: 'french',
        interestRate: 0.08, // 8% monthly
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      expect(result.cft).toBeGreaterThan(0);
      expect(result.tea).toBeGreaterThan(0);
      expect(result.tna).toBeGreaterThan(0);
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

  describe('Penalty Calculation', () => {
    it('should return 0 within grace period', () => {
      const penalty = calculatePenalty(
        100000, // $1,000
        new Date('2024-01-01'),
        new Date('2024-01-05'), // 4 days after
        5, // 5 grace days
        0.001, // 0.1% daily
        0.30 // 30% cap
      );
      
      expect(penalty).toBe(0);
    });

    it('should calculate penalty after grace period', () => {
      const penalty = calculatePenalty(
        100000, // $1,000
        new Date('2024-01-01'),
        new Date('2024-01-11'), // 10 days after
        5, // 5 grace days
        0.001, // 0.1% daily
        0.30 // 30% cap
      );
      
      // 5 days overdue (10 - 5 grace) * 0.1% * $1,000 = $5
      expect(penalty).toBe(500);
    });

    it('should respect penalty cap', () => {
      const penalty = calculatePenalty(
        100000, // $1,000
        new Date('2024-01-01'),
        new Date('2024-12-31'), // ~365 days after
        0, // 0 grace days
        0.01, // 1% daily (very high)
        0.30 // 30% cap
      );
      
      // Should be capped at 30% of $1,000 = $300
      expect(penalty).toBe(30000);
    });

    it('should return 0 for future due dates', () => {
      const penalty = calculatePenalty(
        100000,
        new Date('2024-12-31'),
        new Date('2024-01-01'),
        0,
        0.001,
        0.30
      );
      
      expect(penalty).toBe(0);
    });
  });

  describe('Currency Formatting', () => {
    it('should format cents to ARS currency', () => {
      const formatted100 = formatCurrency(10000);
      expect(formatted100).toContain('100');
      expect(formatted100).toContain('00');
      
      const formatted1500 = formatCurrency(150050);
      expect(formatted1500).toContain('1');
      expect(formatted1500).toContain('500');
    });

    it('should handle zero', () => {
      const formatted = formatCurrency(0);
      expect(formatted).toContain('0');
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
        numInstallments: 60, // 5 years
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
        cashPriceCents: 100, // $1 ARS
        adminFeeCents: 10, // $0.10
        numInstallments: 3,
        interestType: 'fixed_surcharge',
        interestRate: 0.10,
        startDate: new Date('2024-01-01'),
      };
      
      const result = calculateAmortization(input);
      
      expect(result.installments).toHaveLength(3);
      const sumTotal = result.installments.reduce((sum, inst) => sum + inst.totalCents, 0);
      expect(Math.abs(sumTotal - result.totalAmountCents)).toBeLessThanOrEqual(3);
    });

    it('should handle high interest rates', () => {
      const input: AmortizationInput = {
        ...baseInput,
        interestType: 'french',
        interestRate: 0.50, // 50% monthly (extreme)
      };
      
      const result = calculateAmortization(input);
      
      expect(result.totalAmountCents).toBeGreaterThan(input.cashPriceCents * 2);
      expect(result.cft).toBeGreaterThan(100);
    });
  });
});
