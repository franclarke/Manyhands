import { describe, it, expect } from 'vitest';
import { add } from '../src/add'; // Import add from add.ts directly

describe('add', () => {
  it('should add two positive numbers correctly', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('should add a positive and a negative number correctly', () => {
    expect(add(5, -3)).toBe(2);
  });

  it('should add two negative numbers correctly', () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it('should add zero correctly', () => {
    expect(add(0, 0)).toBe(0);
    expect(add(5, 0)).toBe(5);
    expect(add(0, -5)).toBe(-5);
  });

  it('should handle floating point numbers correctly', () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
    expect(add(1.5, 2.5)).toBe(4.0);
  });
});