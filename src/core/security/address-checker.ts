import { isAddress } from 'viem';
import { StrKey } from '@stellar/stellar-sdk';
import { isValidClassicAddress } from 'xrpl';
import { VmType } from '../skills/skill.types.js';

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
        const isValid = isValidClassicAddress(trimmed);
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
