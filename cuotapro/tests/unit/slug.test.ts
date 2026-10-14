import { describe, it, expect } from 'vitest';
import { generateSlug, addSlugSuffix } from '../../src/lib/utils/slug';

describe('generateSlug', () => {
  it('converts basic name to lowercase slug', () => {
    expect(generateSlug('Mi Tienda')).toBe('mi-tienda');
  });

  it('removes accents and diacritics', () => {
    expect(generateSlug('Café París')).toBe('cafe-paris');
    expect(generateSlug('Ñoño Año')).toBe('nono-ano');
    expect(generateSlug('Distribuidora González')).toBe('distribuidora-gonzalez');
  });

  it('handles special characters', () => {
    expect(generateSlug('Mi Negocio #1!')).toBe('mi-negocio-1');
    expect(generateSlug('Tienda @Online')).toBe('tienda-online');
    expect(generateSlug('Shop & Store')).toBe('shop-store');
  });

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('Mi    Tienda')).toBe('mi-tienda');
    expect(generateSlug('Mi--Tienda')).toBe('mi-tienda');
    expect(generateSlug('Mi - - Tienda')).toBe('mi-tienda');
  });

  it('removes leading and trailing hyphens', () => {
    expect(generateSlug('-Mi Tienda-')).toBe('mi-tienda');
    expect(generateSlug('  Mi Tienda  ')).toBe('mi-tienda');
  });

  it('limits slug length to 50 characters', () => {
    const longName = 'Esta es una tienda con un nombre muy muy muy largo que excede el limite';
    const slug = generateSlug(longName);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).toBe('esta-es-una-tienda-con-un-nombre-muy-muy-muy-largo');
  });

  it('returns fallback for empty or invalid input', () => {
    expect(generateSlug('')).toBe('negocio');
    expect(generateSlug('   ')).toBe('negocio');
    expect(generateSlug('!!!@@@###')).toBe('negocio');
  });

  it('handles null/undefined gracefully', () => {
    expect(generateSlug(null as unknown as string)).toBe('negocio');
    expect(generateSlug(undefined as unknown as string)).toBe('negocio');
  });

  it('handles numbers correctly', () => {
    expect(generateSlug('Tienda 24 Horas')).toBe('tienda-24-horas');
    expect(generateSlug('123 Store')).toBe('123-store');
  });

  it('handles real Argentine business names', () => {
    expect(generateSlug('Panadería San José')).toBe('panaderia-san-jose');
    expect(generateSlug('Ferretería El Tornillo')).toBe('ferreteria-el-tornillo');
    expect(generateSlug('Kiosco de María')).toBe('kiosco-de-maria');
    expect(generateSlug('Carnicería Don Pedro')).toBe('carniceria-don-pedro');
  });
});

describe('addSlugSuffix', () => {
  it('adds numeric suffix to slug', () => {
    expect(addSlugSuffix('mi-tienda', 2)).toBe('mi-tienda-2');
    expect(addSlugSuffix('negocio', 100)).toBe('negocio-100');
  });
});
