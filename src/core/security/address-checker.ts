import crypto from 'node:crypto';
import { isAddress } from 'viem';
import { StrKey } from '@stellar/stellar-sdk';
import { VmType } from '../skills/skill.types.js';

const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function decodeRippleBase58(str: string): Buffer | null {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const value = RIPPLE_ALPHABET.indexOf(char);
    if (value === -1) return null;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === RIPPLE_ALPHABET[0]; i++) {
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

function isValidXrplClassicAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (!address.startsWith('r')) return false;
  if (address.length < 25 || address.length > 35) return false;
  const decoded = decodeRippleBase58(address);
  if (!decoded || decoded.length < 5) return false;
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const hash1 = crypto.createHash('sha256').update(payload).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return checksum.equals(hash2.subarray(0, 4));
}

export interface AddressValidationResult {
  isValid: boolean;
  normalizedAddress: string;
  vmType: VmType;
  requiresMemoWarning: boolean;
  error?: string;
}

export class AddressChecker {
  /**
   * Validates target address strictly against VM rules
   */
  public static validate(address: string, vmType: VmType): AddressValidationResult {
    const trimmed = address.trim();

    switch (vmType) {
      case 'evm': {
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
          return {
            isValid: false,
            normalizedAddress: trimmed,
            vmType: 'evm',
            requiresMemoWarning: false,
            error: `Secret/private key detected! Never enter private keys: "${trimmed}"`,
          };
        }
        if (!isAddress(trimmed)) {
          return {
            isValid: false,
            normalizedAddress: trimmed,
            vmType: 'evm',
            requiresMemoWarning: false,
            error: `Invalid EVM checksum address format: "${trimmed}"`,
          };
        }
        return {
          isValid: true,
          normalizedAddress: trimmed.toLowerCase(),
          vmType: 'evm',
          requiresMemoWarning: false,
        };
      }

      case 'stellar': {
        if (trimmed.startsWith('S') || StrKey.isValidEd25519SecretSeed(trimmed)) {
          return {
            isValid: false,
            normalizedAddress: trimmed,
            vmType: 'stellar',
            requiresMemoWarning: false,
            error: `Secret/private key detected! Never enter private keys: "${trimmed}"`,
          };
        }
        const isValid = StrKey.isValidEd25519PublicKey(trimmed);
        if (!isValid) {
          return {
            isValid: false,
            normalizedAddress: trimmed,
            vmType: 'stellar',
            requiresMemoWarning: false,
            error: `Invalid Stellar Public Key (must be valid 56-character StrKey starting with G): "${trimmed}"`,
          };
        }
        return {
          isValid: true,
          normalizedAddress: trimmed,
          vmType: 'stellar',
          requiresMemoWarning: true, // Warn user about Stellar memos for exchange deposits
        };
      }

      case 'xrpl': {
        const isValid = isValidXrplClassicAddress(trimmed);
        if (!isValid) {
          return {
            isValid: false,
            normalizedAddress: trimmed,
            vmType: 'xrpl',
            requiresMemoWarning: false,
            error: `Invalid XRPL classic address (must be valid Base58Check address starting with r): "${trimmed}"`,
          };
        }
        return {
          isValid: true,
          normalizedAddress: trimmed,
          vmType: 'xrpl',
          requiresMemoWarning: true, // Warn user about XRPL Destination Tag
        };
      }

      default:
        return {
          isValid: false,
          normalizedAddress: trimmed,
          vmType,
          requiresMemoWarning: false,
          error: `Unsupported VM type: ${vmType}`,
        };
    }
  }
}
