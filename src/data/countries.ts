// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Country names used to tell where an address is. English names are the
 * maintainers' (`original`); names in other languages are `translation` and
 * need review. The list covers the EU Member States, the other EEA states,
 * and countries where many consumer products sold in the EU are made.
 *
 * "Established in the Union" (GPSR Art. 19(b)) means an EU Member State.
 * Iceland, Liechtenstein and Norway are flagged `eea` and treated as
 * "unknown": whether an EEA establishment counts depends on the EEA Agreement,
 * which Safeshelf does not assess.
 */

/** Where a country stands for the responsible-person rule. */
export type Region = 'eu' | 'eea' | 'other';

/** One country. */
export interface Country {
  /** ISO 3166-1 alpha-2 code. */
  readonly code: string;
  readonly region: Region;
  /** Lower-case names: English first, then other languages. */
  readonly names: readonly string[];
}

const C = (code: string, region: Region, names: readonly string[]): Country => Object.freeze({ code, region, names: Object.freeze(names) });

/** The country list. */
export const COUNTRIES: readonly Country[] = Object.freeze([
  C('AT', 'eu', ['austria', 'österreich', 'autriche', 'austria']),
  C('BE', 'eu', ['belgium', 'belgië', 'belgique', 'belgien', 'belgio']),
  C('BG', 'eu', ['bulgaria', 'българия', 'bulgarien', 'bulgarie']),
  C('HR', 'eu', ['croatia', 'hrvatska', 'kroatien', 'croatie']),
  C('CY', 'eu', ['cyprus', 'κύπρος', 'zypern', 'chypre']),
  C('CZ', 'eu', ['czechia', 'czech republic', 'česko', 'česká republika', 'tschechien', 'tchéquie']),
  C('DK', 'eu', ['denmark', 'danmark', 'dänemark', 'danemark']),
  C('EE', 'eu', ['estonia', 'eesti', 'estland', 'estonie']),
  C('FI', 'eu', ['finland', 'suomi', 'finnland', 'finlande']),
  C('FR', 'eu', ['france', 'frankreich', 'francia', 'frankrijk']),
  C('DE', 'eu', ['germany', 'deutschland', 'allemagne', 'alemania', 'germania', 'duitsland', 'niemcy', 'vokietija']),
  C('GR', 'eu', ['greece', 'ελλάδα', 'ελλάς', 'griechenland', 'grèce']),
  C('HU', 'eu', ['hungary', 'magyarország', 'ungarn', 'hongrie']),
  C('IE', 'eu', ['ireland', 'éire', 'irland', 'irlande']),
  C('IT', 'eu', ['italy', 'italia', 'italien', 'italie']),
  C('LV', 'eu', ['latvia', 'latvija', 'lettland', 'lettonie']),
  C('LT', 'eu', ['lithuania', 'lietuva', 'litauen', 'lituanie']),
  C('LU', 'eu', ['luxembourg', 'luxemburg', 'lëtzebuerg']),
  C('MT', 'eu', ['malta', 'malte']),
  C('NL', 'eu', ['netherlands', 'the netherlands', 'nederland', 'niederlande', 'pays-bas', 'holland']),
  C('PL', 'eu', ['poland', 'polska', 'polen', 'pologne']),
  C('PT', 'eu', ['portugal']),
  C('RO', 'eu', ['romania', 'românia', 'rumänien', 'roumanie']),
  C('SK', 'eu', ['slovakia', 'slovensko', 'slowakei', 'slovaquie']),
  C('SI', 'eu', ['slovenia', 'slovenija', 'slowenien', 'slovénie']),
  C('ES', 'eu', ['spain', 'españa', 'spanien', 'espagne', 'spagna']),
  C('SE', 'eu', ['sweden', 'sverige', 'schweden', 'suède']),
  C('IS', 'eea', ['iceland', 'ísland', 'island']),
  C('LI', 'eea', ['liechtenstein']),
  C('NO', 'eea', ['norway', 'norge', 'norwegen', 'norvège']),
  C('CH', 'other', ['switzerland', 'schweiz', 'suisse', 'svizzera']),
  C('GB', 'other', ['united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland', 'vereinigtes königreich', 'royaume-uni', 'reino unido', 'regno unito', 'verenigd koninkrijk', 'wielka brytania', 'didžioji britanija', 'spojené království', 'yhdistynyt kuningaskunta', 'storbritannien']),
  C('US', 'other', ['united states', 'united states of america', 'usa', 'u.s.a.', 'vereinigte staaten', 'états-unis', 'estados unidos', 'stati uniti', 'verenigde staten', 'stany zjednoczone', 'jungtinės valstijos', 'spojené státy']),
  C('CA', 'other', ['canada', 'kanada']),
  C('CN', 'other', ['china', "people's republic of china", 'p.r. china', 'p.r.c.', 'prc', 'volksrepublik china', 'chine', 'cina', 'chiny', 'kinija', 'čína', 'kiina', 'kina', 'kína', 'ķīna', 'hiina', 'kitajska', 'китай', 'κίνα', '中国', '中华人民共和国']),
  C('HK', 'other', ['hong kong', 'hongkong', '香港']),
  C('TW', 'other', ['taiwan', '台灣', '台湾']),
  C('JP', 'other', ['japan', 'japon', '日本']),
  C('KR', 'other', ['south korea', 'republic of korea', 'korea', 'südkorea', 'corée du sud', '대한민국']),
  C('IN', 'other', ['india', 'indien', 'inde']),
  C('VN', 'other', ['vietnam', 'viet nam']),
  C('TH', 'other', ['thailand', 'thaïlande']),
  C('MY', 'other', ['malaysia']),
  C('ID', 'other', ['indonesia', 'indonesien']),
  C('BD', 'other', ['bangladesh', 'bangladesch']),
  C('PK', 'other', ['pakistan']),
  C('TR', 'other', ['turkey', 'türkiye', 'türkei', 'turquie', 'turquía', 'turchia', 'turkije', 'turcja', 'turkija', 'turecko', 'turkki', 'turkiet', 'tyrkiet', 'törökország', 'turcia', 'turčija', 'turska']),
  C('UA', 'other', ['ukraine', 'україна']),
  C('RS', 'other', ['serbia', 'србија', 'serbien']),
  C('BA', 'other', ['bosnia and herzegovina', 'bosnien und herzegowina']),
  C('MX', 'other', ['mexico', 'méxico', 'mexiko']),
  C('BR', 'other', ['brazil', 'brasil', 'brasilien']),
  C('AU', 'other', ['australia', 'australien']),
  C('IL', 'other', ['israel']),
  C('AE', 'other', ['united arab emirates', 'uae', 'vereinigte arabische emirate']),
  C('SG', 'other', ['singapore', 'singapur']),
]);
