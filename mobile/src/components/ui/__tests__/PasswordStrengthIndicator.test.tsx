import React from 'react';
import { act, create } from 'react-test-renderer';
import { PasswordStrengthIndicator } from '../PasswordStrengthIndicator';

jest.mock('../../../services/vault', () => ({
  VAULT_PASSWORD_MIN_LENGTH: 12,
}));

const findTextContent = (tree: ReturnType<typeof create>, predicate: (text: string) => boolean) => {
  const json = JSON.stringify(tree.toJSON());
  return predicate(json);
};

describe('PasswordStrengthIndicator', () => {
  it('renders nothing when password is empty', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="" />);
    });
    expect(tree.toJSON()).toBeNull();
  });

  it('shows weak for short passwords', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="abc" />);
    });
    expect(findTextContent(tree, (t) => t.includes('Weak'))).toBe(true);
  });

  it('shows characters needed warning below min length', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="shortpw" />);
    });
    expect(findTextContent(tree, (t) => t.includes('more characters needed'))).toBe(true);
  });

  it('hides warning when min length met', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="exactlytwelve" />);
    });
    expect(findTextContent(tree, (t) => t.includes('more characters needed'))).toBe(false);
  });

  it('shows strong for high-entropy passwords', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="MyStr0ng!Pass#2024" />);
    });
    expect(findTextContent(tree, (t) => t.includes('Strong'))).toBe(true);
  });

  it('displays entropy in bits', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<PasswordStrengthIndicator password="testpassword" />);
    });
    expect(findTextContent(tree, (t) => t.includes('bits'))).toBe(true);
  });

  it('calculates entropy correctly for lowercase only', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      // 12 lowercase chars = 12 * log2(26) ≈ 56 bits
      tree = create(<PasswordStrengthIndicator password="abcdefghijkl" />);
    });
    const json = JSON.stringify(tree.toJSON());
    // The entropy displays as two children: "56" and " bits"
    // Should be approximately 56 bits for 12 lowercase chars
    expect(json).toMatch(/["']5[56]["'].*bits/);
  });

  it('increases entropy with mixed character classes', () => {
    let tree1!: ReturnType<typeof create>;
    let tree2!: ReturnType<typeof create>;
    act(() => {
      tree1 = create(<PasswordStrengthIndicator password="aaaaaaaaaaaa" />);
      tree2 = create(<PasswordStrengthIndicator password="Aa1!Aa1!Aa1!" />);
    });

    const getEntropy = (tree: ReturnType<typeof create>) => {
      const json = JSON.stringify(tree.toJSON());
      // Match number followed by "bits" in children array format
      const match = json.match(/"(\d+)",\s*" bits"/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const entropyLowerOnly = getEntropy(tree1);
    const entropyMixed = getEntropy(tree2);
    expect(entropyMixed).toBeGreaterThan(entropyLowerOnly);
  });
});
