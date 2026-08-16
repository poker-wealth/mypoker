import type { KmsSignPort } from './kms-signer';

/**
 * The AWS KMS backing for {@link KmsSignPort}. The CMK must be an asymmetric secp256k1 signing key
 * (KeySpec `ECC_SECG_P256K1`, KeyUsage `SIGN_VERIFY`). The private key never leaves KMS; we send the
 * 32-byte txID digest and KMS returns a DER signature.
 *
 * `@aws-sdk/client-kms` is imported dynamically so a local-key deploy never loads the SDK at boot.
 *
 * ⚠️ Untestable boundary: the two network calls below cannot be exercised without a live CMK. Every
 * bit of signing LOGIC lives in kms-signer.ts and is unit-tested against a fake port — this file is
 * only the transport. Verify it on the first testnet KMS send before trusting it with mainnet funds.
 */
export class AwsKmsSignPort implements KmsSignPort {
  constructor(
    private readonly keyId: string,
    private readonly region?: string,
  ) {}

  private async client(): Promise<import('@aws-sdk/client-kms').KMSClient> {
    const { KMSClient } = await import('@aws-sdk/client-kms');
    return new KMSClient(this.region ? { region: this.region } : {});
  }

  async getPublicKeyDer(): Promise<Uint8Array> {
    const { GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
    const out = await (await this.client()).send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!out.PublicKey) throw new Error('KMS GetPublicKey returned no public key');
    return new Uint8Array(out.PublicKey);
  }

  async signDigest(digest: Uint8Array): Promise<Uint8Array> {
    const { SignCommand } = await import('@aws-sdk/client-kms');
    const out = await (await this.client()).send(
      new SignCommand({
        KeyId: this.keyId,
        Message: digest,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      }),
    );
    if (!out.Signature) throw new Error('KMS Sign returned no signature');
    return new Uint8Array(out.Signature);
  }
}
