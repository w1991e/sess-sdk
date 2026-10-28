// ISO 4217 minor units: the currencies an items component may state and the exponent of each
// one's minor unit. A copy of the Sess runtime's table (packages/core/src/currency.ts, transcribed
// by Sess from ISO 4217 List One, "Minor unit" column). Codes with no minor unit (XAU, XDR, XXX …)
// are not listed and are refused, as Sess refuses them. tests/unit/commerce-contract.test.ts pins
// this table to the runtime's, extracted at a recorded runtime commit.

const BY_EXPONENT: readonly (readonly [0 | 2 | 3 | 4, string])[] = [
  [0, 'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF'],
  [
    2,
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BOV BRL BSD BTN BWP BYN BZD ' +
      'CAD CDF CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS ' +
      'GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL ' +
      'MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK ' +
      'PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB ' +
      'TJS TMT TOP TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG ZWL',
  ],
  [3, 'BHD IQD JOD KWD LYD OMR TND'],
  [4, 'CLF UYW'],
];

/** Every ISO 4217 code Sess accepts and its minor-unit exponent (JPY 0, USD 2, BHD 3, CLF 4). */
export const CURRENCY_MINOR_UNITS: ReadonlyMap<string, 0 | 2 | 3 | 4> = new Map(
  BY_EXPONENT.flatMap(([exponent, codes]) => codes.split(' ').map((code) => [code, exponent] as const)),
);

/** The minor-unit exponent of a currency Sess accepts, else undefined. */
export function minorUnits(currency: string): 0 | 2 | 3 | 4 | undefined {
  return CURRENCY_MINOR_UNITS.get(currency);
}
