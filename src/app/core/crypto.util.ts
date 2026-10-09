import * as CryptoJS from 'crypto-js';
import { JSEncrypt } from 'jsencrypt';

/** Same AES/RSA helpers used by MasterAdminUI for session + login domain token */
export class CryptoUtil {
  private static readonly yek = '$uPer@dm1n~dI@z7';

  static readonly rsaPublicKey = `-----BEGIN PUBLIC KEY-----
MIICITANBgkqhkiG9w0BAQEFAAOCAg4AMIICCQKCAgB0rRSHGZK/FtK15IRfQxtl
dN5ToPtfXGzTNBe1vGhow5xqp6BLubMKKPwCj3zOJiAm1Ip1VNqqYxWnaL8ZErBF
rErtE0r7kn50QgGgJCpdrWJ4unhaoe1su207d9oY6D6OBH90v1aXA6ZjN7zTJmiq
FJZOOTQE6t/XwNAOphq/B6Lcr1iQSQmSqaMozy4OQ4NvIzNTQn5tcs9qJBMsKFeU
cSp8VK76JBNEqSuEHNmbV2d/IQ5XAqVUiAs34kH2xWRSbBmy0WK3c3QKGzC1MRWM
9JauLN56TKUFOmUSjfWY3caJru6HxsiMTGKnvflXHfgA2aLAPxu72pIHoCTy5Hxj
AUoKM7qXUn/kQj4Ci0M/0LRF4boqd37wpbyVNeXNvqm+dLjxklf/+NHMfNL2Wvb4
ekHUVI8nMVPgswIcQ7q/Njf9DC+LA+/duf8m9JDjI3J6r9y1gQugdkLETGzF2Gj1
ToU0Pocrg6CFHImqq2z+cOeWnURrV0f0I1UWWGCb79OZxZ5oDjM9uCLRsoe8+Npg
ACZNf4AbnM7OUNj5TEYs6t/tUYouvTB7gH452I3EH6KWBl+ZTgCg0RFkOMazNOjn
4J0yfbaPvpVgKzF2WRyn63mTO2tdLRl5s9uqMFhXmCs6IzEqBpxMKL1aS6ONZLDG
5qPtpCPJnUFQEBTVlSO15QIDAQAB
-----END PUBLIC KEY-----`;

  private static encryptText(plainText: string): string {
    const key = CryptoJS.enc.Utf8.parse(this.yek);
    const iv = CryptoJS.enc.Utf8.parse(this.yek);
    return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plainText), key, {
      keySize: 128 / 8,
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).toString();
  }

  private static decryptText(cipherText: string): string {
    const key = CryptoJS.enc.Utf8.parse(this.yek);
    const iv = CryptoJS.enc.Utf8.parse(this.yek);
    return CryptoJS.AES.decrypt(cipherText, key, {
      keySize: 128 / 8,
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).toString(CryptoJS.enc.Utf8);
  }

  static setSessionStorage(key: string, value: string): void {
    sessionStorage.setItem(key, this.encryptText(value));
  }

  static getSessionStorage(key: string): string | undefined {
    const value = sessionStorage.getItem(key);
    if (value) {
      return this.decryptText(value);
    }
    return undefined;
  }

  static encryptRSA(publicKey: string, jsonString: string): string | false {
    const encryptor = new JSEncrypt();
    encryptor.setPublicKey(publicKey);
    return encryptor.encrypt(jsonString);
  }

  static buildDomainToken(domain: string, adjustedLocalTimeMs: number): string {
    const domainTime = `${domain}~${adjustedLocalTimeMs}`;
    return String(this.encryptRSA(this.rsaPublicKey, domainTime) || '');
  }
}
