// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Label phrases that introduce the information Art. 19 asks for, in the 24
 * official EU languages.
 *
 * Origin of each phrase (`source`):
 * - `official-text`: the word or words appear verbatim in that language
 *   version of GPSR Art. 19 (test/unit/legal.test.ts checks this against the
 *   stored official text). Inflected forms are kept as they appear there.
 *   Art. 19 does not name the fulfilment service provider, so its
 *   `official-text` phrases are the defined term of GPSR Art. 3, point (12),
 *   checked against that stored text instead.
 * - `original`: English written by the maintainers.
 * - `translation`: everything else. These are the maintainers' translations of
 *   common shop labels and need review by native speakers (see README).
 *
 * A phrase counts only in label position: at the start of a short heading,
 * term, table header cell or tab, or at the start of a text followed by a colon
 * or dash. "The manufacturer recommends ..." in running text is not a label.
 */

import type { PhraseSource, SourcedPhrase } from '../types.js';

/** What a label introduces. */
export type LabelCategory =
  | 'manufacturer'
  | 'responsible'
  | 'importer'
  | 'representative'
  | 'fulfilment'
  | 'brand'
  | 'safety'
  | 'type'
  | 'identifier'
  | 'seller'
  | 'stop';

/** A label phrase. */
export interface LabelPhrase extends SourcedPhrase {
  readonly category: LabelCategory;
}

type Row = readonly [lang: string, category: LabelCategory, source: PhraseSource, texts: readonly string[]];

const O: PhraseSource = 'official-text';
const T: PhraseSource = 'translation';
const E: PhraseSource = 'original';

const ROWS: readonly Row[] = [
  // English
  ['en', 'manufacturer', O, ['manufacturer']],
  ['en', 'manufacturer', E, ['manufacturer information', 'manufacturer details', 'manufacturer contact', 'manufactured by', 'producer']],
  ['en', 'responsible', O, ['responsible person']],
  ['en', 'responsible', E, ['eu responsible person', 'responsible person in the eu', 'responsible person in the european union', 'eu representative', 'responsible economic operator']],
  ['en', 'importer', E, ['importer', 'imported by', 'eu importer']],
  ['en', 'representative', E, ['authorised representative', 'authorized representative']],
  ['en', 'fulfilment', O, ['fulfilment service provider']],
  ['en', 'fulfilment', E, ['fulfillment service provider', 'eu fulfilment service provider']],
  ['en', 'brand', E, ['brand', 'trade mark', 'trademark']],
  ['en', 'safety', O, ['warning', 'safety information']],
  ['en', 'safety', E, ['warnings', 'safety warnings', 'safety instructions', 'safety notes', 'caution', 'product safety']],
  ['en', 'type', O, ['type']],
  ['en', 'type', E, ['model', 'model number', 'model no', 'model name', 'item model number', 'type designation']],
  ['en', 'identifier', O, ['product identifier']],
  ['en', 'identifier', E, ['sku', 'gtin', 'ean', 'upc', 'isbn', 'mpn', 'item number', 'item no', 'article number', 'art. no', 'part number', 'manufacturer part number', 'product code', 'barcode', 'batch number', 'serial number', 'asin', 'ean13']],
  ['en', 'seller', E, ['seller', 'sold by', 'seller information', 'sold and shipped by', 'merchant', 'trader', 'dispatched from and sold by']],
  ['en', 'stop', E, ['description', 'product description', 'shipping', 'delivery', 'returns', 'reviews', 'customer reviews', 'payment', 'you may also like', 'related products', 'specifications', 'size guide', 'share']],

  // German
  ['de', 'manufacturer', O, ['hersteller']],
  ['de', 'manufacturer', T, ['herstellerinformationen', 'herstellerangaben', 'angaben zum hersteller', 'informationen zum hersteller', 'herstelleradresse']],
  ['de', 'responsible', O, ['verantwortlichen person']],
  ['de', 'responsible', T, ['verantwortliche person', 'verantwortliche person in der eu', 'eu-verantwortlicher', 'eu-verantwortliche person', 'verantwortlicher wirtschaftsakteur']],
  ['de', 'importer', T, ['importeur', 'einführer', 'inverkehrbringer']],
  ['de', 'representative', T, ['bevollmächtigter', 'eu-bevollmächtigter']],
  ['de', 'fulfilment', O, ['fulfilment-dienstleister']],
  ['de', 'fulfilment', T, ['fulfillment-dienstleister']],
  ['de', 'brand', T, ['marke']],
  ['de', 'safety', O, ['warnhinweise', 'sicherheitsinformationen']],
  ['de', 'safety', T, ['warnhinweis', 'sicherheitshinweise', 'sicherheitshinweis', 'achtung', 'produktsicherheit']],
  ['de', 'type', T, ['typ', 'modell', 'typenbezeichnung', 'modellnummer']],
  ['de', 'identifier', O, ['produktidentifikatoren']],
  ['de', 'identifier', T, ['artikelnummer', 'art.-nr', 'artikel-nr', 'herstellernummer', 'produktnummer', 'chargennummer', 'seriennummer']],
  ['de', 'seller', T, ['verkäufer', 'verkauft von', 'händler', 'anbieter']],
  ['de', 'stop', T, ['beschreibung', 'produktbeschreibung', 'versand', 'lieferung', 'rückgabe', 'bewertungen', 'zahlung', 'das könnte dir auch gefallen']],

  // French
  ['fr', 'manufacturer', O, ['fabricant']],
  ['fr', 'manufacturer', T, ['informations sur le fabricant', 'coordonnées du fabricant', 'fabriqué par']],
  ['fr', 'responsible', O, ['personne responsable']],
  ['fr', 'responsible', T, ['personne responsable dans l\'ue', 'responsable ue', 'opérateur économique responsable']],
  ['fr', 'importer', T, ['importateur', 'importé par']],
  ['fr', 'representative', T, ['mandataire', 'représentant autorisé']],
  ['fr', 'fulfilment', O, ['prestataire de services d\'exécution des commandes']],
  ['fr', 'brand', T, ['marque']],
  ['fr', 'safety', O, ['avertissement']],
  ['fr', 'safety', T, ['avertissements', 'consignes de sécurité', 'informations de sécurité', 'mises en garde', 'attention', 'sécurité du produit']],
  ['fr', 'type', O, ['type']],
  ['fr', 'type', T, ['modèle', 'numéro de modèle']],
  ['fr', 'identifier', O, ['identifiant du produit']],
  ['fr', 'identifier', T, ['référence', 'réf', 'code article', 'numéro d\'article', 'code-barres']],
  ['fr', 'seller', T, ['vendeur', 'vendu par', 'vendu et expédié par']],
  ['fr', 'stop', T, ['description', 'livraison', 'retours', 'avis', 'avis clients', 'paiement']],

  // Spanish
  ['es', 'manufacturer', O, ['fabricante']],
  ['es', 'manufacturer', T, ['información del fabricante', 'datos del fabricante', 'fabricado por']],
  ['es', 'responsible', O, ['persona responsable']],
  ['es', 'responsible', T, ['persona responsable en la ue', 'responsable en la ue']],
  ['es', 'importer', T, ['importador', 'importado por']],
  ['es', 'representative', T, ['representante autorizado']],
  ['es', 'fulfilment', O, ['prestador de servicios logísticos']],
  ['es', 'brand', T, ['marca']],
  ['es', 'safety', O, ['advertencia']],
  ['es', 'safety', T, ['advertencias', 'información de seguridad', 'instrucciones de seguridad', 'precaución']],
  ['es', 'type', O, ['modelo']],
  ['es', 'type', T, ['tipo']],
  ['es', 'identifier', O, ['identificador del producto']],
  ['es', 'identifier', T, ['referencia', 'ref', 'código de artículo', 'código del producto']],
  ['es', 'seller', T, ['vendedor', 'vendido por']],
  ['es', 'stop', T, ['descripción', 'envío', 'devoluciones', 'opiniones', 'pago']],

  // Italian
  ['it', 'manufacturer', O, ['fabbricante']],
  ['it', 'manufacturer', T, ['produttore', 'informazioni sul produttore', 'prodotto da']],
  ['it', 'responsible', O, ['responsabile']],
  ['it', 'responsible', T, ['persona responsabile', 'responsabile ue', 'responsabile nell\'ue']],
  ['it', 'importer', T, ['importatore', 'importato da']],
  ['it', 'representative', T, ['mandatario', 'rappresentante autorizzato']],
  ['it', 'fulfilment', O, ['fornitore di servizi di logistica']],
  ['it', 'brand', T, ['marca', 'marchio']],
  ['it', 'safety', O, ['avvertenza']],
  ['it', 'safety', T, ['avvertenze', 'informazioni sulla sicurezza', 'istruzioni di sicurezza', 'attenzione']],
  ['it', 'type', O, ['tipo']],
  ['it', 'type', T, ['modello']],
  ['it', 'identifier', O, ['identificatore del prodotto']],
  ['it', 'identifier', T, ['codice articolo', 'codice prodotto', 'cod. articolo']],
  ['it', 'seller', T, ['venditore', 'venduto da']],
  ['it', 'stop', T, ['descrizione', 'spedizione', 'resi', 'recensioni', 'pagamento']],

  // Dutch
  ['nl', 'manufacturer', O, ['fabrikant']],
  ['nl', 'manufacturer', T, ['fabrikantgegevens', 'producent', 'gemaakt door']],
  ['nl', 'responsible', O, ['verantwoordelijke']],
  ['nl', 'responsible', T, ['verantwoordelijke persoon', 'verantwoordelijke in de eu']],
  ['nl', 'importer', T, ['importeur', 'geïmporteerd door']],
  ['nl', 'representative', T, ['gemachtigde', 'gemachtigd vertegenwoordiger']],
  ['nl', 'fulfilment', O, ['fulfilmentdienstverlener']],
  ['nl', 'fulfilment', T, ['fulfilment-dienstverlener']],
  ['nl', 'brand', T, ['merk']],
  ['nl', 'safety', O, ['waarschuwingen', 'veiligheidsinformatie']],
  ['nl', 'safety', T, ['waarschuwing', 'veiligheidsinstructies', 'veiligheidsvoorschriften', 'let op']],
  ['nl', 'type', O, ['type']],
  ['nl', 'type', T, ['model', 'modelnummer']],
  ['nl', 'identifier', O, ['productidentificatie']],
  ['nl', 'identifier', T, ['artikelnummer', 'productcode']],
  ['nl', 'seller', T, ['verkoper', 'verkocht door']],
  ['nl', 'stop', T, ['beschrijving', 'productbeschrijving', 'verzending', 'levering', 'retourneren', 'beoordelingen', 'betaling']],

  // Polish
  ['pl', 'manufacturer', O, ['producent', 'producenta']],
  ['pl', 'manufacturer', T, ['informacje o producencie', 'dane producenta']],
  ['pl', 'responsible', O, ['osoby odpowiedzialnej']],
  ['pl', 'responsible', T, ['osoba odpowiedzialna', 'osoba odpowiedzialna w ue']],
  ['pl', 'importer', T, ['importer', 'importowane przez']],
  ['pl', 'representative', T, ['upoważniony przedstawiciel']],
  ['pl', 'fulfilment', O, ['dostawca usług realizacji zamówień']],
  ['pl', 'brand', T, ['marka']],
  ['pl', 'safety', O, ['ostrzeżenia']],
  ['pl', 'safety', T, ['ostrzeżenie', 'informacje o bezpieczeństwie', 'informacje dotyczące bezpieczeństwa', 'uwaga']],
  ['pl', 'type', O, ['rodzaj']],
  ['pl', 'type', T, ['model', 'typ']],
  ['pl', 'identifier', O, ['identyfikatory produktu']],
  ['pl', 'identifier', T, ['kod produktu', 'numer katalogowy', 'indeks']],
  ['pl', 'seller', T, ['sprzedawca', 'sprzedawane przez']],
  ['pl', 'stop', T, ['opis', 'opis produktu', 'dostawa', 'zwroty', 'opinie', 'płatność']],

  // Portuguese
  ['pt', 'manufacturer', O, ['fabricante']],
  ['pt', 'manufacturer', T, ['informações do fabricante', 'fabricado por']],
  ['pt', 'responsible', O, ['pessoa responsável']],
  ['pt', 'responsible', T, ['pessoa responsável na ue', 'responsável na ue']],
  ['pt', 'importer', T, ['importador', 'importado por']],
  ['pt', 'representative', T, ['mandatário', 'representante autorizado']],
  ['pt', 'fulfilment', O, ['prestador de serviços de execução']],
  ['pt', 'brand', T, ['marca']],
  ['pt', 'safety', O, ['alertas', 'informações de segurança']],
  ['pt', 'safety', T, ['avisos', 'advertências', 'instruções de segurança']],
  ['pt', 'type', O, ['tipo']],
  ['pt', 'type', T, ['modelo']],
  ['pt', 'identifier', O, ['identificador do produto']],
  ['pt', 'identifier', T, ['referência', 'código do artigo', 'código do produto']],
  ['pt', 'seller', T, ['vendedor', 'vendido por']],
  ['pt', 'stop', T, ['descrição', 'envio', 'devoluções', 'avaliações', 'pagamento']],

  // Lithuanian
  ['lt', 'manufacturer', O, ['gamintojas', 'gamintojo']],
  ['lt', 'manufacturer', T, ['gamintojo informacija', 'gamintojo duomenys', 'pagaminta']],
  ['lt', 'responsible', O, ['atsakingo asmens']],
  ['lt', 'responsible', T, ['atsakingas asmuo', 'atsakingas asmuo es']],
  ['lt', 'importer', T, ['importuotojas']],
  ['lt', 'representative', T, ['įgaliotasis atstovas']],
  ['lt', 'fulfilment', O, ['realizavimo paslaugų teikėjas']],
  ['lt', 'brand', T, ['prekės ženklas']],
  ['lt', 'safety', O, ['perspėjimas', 'saugos informacija']],
  ['lt', 'safety', T, ['įspėjimai', 'įspėjimas', 'saugos nurodymai', 'dėmesio']],
  ['lt', 'type', T, ['tipas', 'modelis']],
  ['lt', 'identifier', T, ['prekės kodas', 'gaminio kodas', 'barkodas']],
  ['lt', 'seller', T, ['pardavėjas', 'parduoda']],
  ['lt', 'stop', T, ['aprašymas', 'pristatymas', 'grąžinimas', 'atsiliepimai', 'apmokėjimas']],

  // Latvian
  ['lv', 'manufacturer', O, ['ražotājs', 'ražotāja']],
  ['lv', 'manufacturer', T, ['informācija par ražotāju']],
  ['lv', 'responsible', O, ['atbildīgās personas']],
  ['lv', 'responsible', T, ['atbildīgā persona']],
  ['lv', 'importer', T, ['importētājs']],
  ['lv', 'representative', T, ['pilnvarotais pārstāvis']],
  ['lv', 'fulfilment', O, ['izpildes pakalpojumu sniedzējs']],
  ['lv', 'brand', T, ['zīmols']],
  ['lv', 'safety', O, ['brīdinājums', 'drošības informācija']],
  ['lv', 'safety', T, ['brīdinājumi']],
  ['lv', 'type', O, ['veids']],
  ['lv', 'type', T, ['modelis', 'tips']],
  ['lv', 'identifier', O, ['identifikators']],
  ['lv', 'identifier', T, ['preces kods', 'artikuls']],
  ['lv', 'seller', T, ['pārdevējs']],
  ['lv', 'stop', T, ['apraksts', 'piegāde', 'atgriešana', 'atsauksmes']],

  // Estonian
  ['et', 'manufacturer', O, ['tootja']],
  ['et', 'responsible', O, ['vastutava isiku']],
  ['et', 'responsible', T, ['vastutav isik']],
  ['et', 'importer', T, ['importija', 'maaletooja']],
  ['et', 'representative', T, ['volitatud esindaja']],
  ['et', 'fulfilment', O, ['tellimuste täitmise teenuse osutaja']],
  ['et', 'brand', T, ['kaubamärk', 'bränd']],
  ['et', 'safety', O, ['hoiatus', 'ohutusteave']],
  ['et', 'safety', T, ['hoiatused', 'ohutusjuhised']],
  ['et', 'type', O, ['tüüp']],
  ['et', 'type', T, ['mudel']],
  ['et', 'identifier', O, ['tootetähis']],
  ['et', 'identifier', T, ['tootekood', 'artikkel']],
  ['et', 'seller', T, ['müüja']],
  ['et', 'stop', T, ['kirjeldus', 'tarne', 'tagastamine', 'arvustused']],

  // Finnish
  ['fi', 'manufacturer', O, ['valmistaja', 'valmistajan']],
  ['fi', 'manufacturer', T, ['valmistajan tiedot']],
  ['fi', 'responsible', O, ['vastuuhenkilön']],
  ['fi', 'responsible', T, ['vastuuhenkilö', 'vastuuhenkilö eu:ssa']],
  ['fi', 'importer', T, ['maahantuoja']],
  ['fi', 'representative', T, ['valtuutettu edustaja']],
  ['fi', 'fulfilment', O, ['jakelupalvelujen tarjoajalla']],
  ['fi', 'fulfilment', T, ['jakelupalvelujen tarjoaja']],
  ['fi', 'brand', T, ['merkki', 'tuotemerkki']],
  ['fi', 'safety', O, ['varoitukset', 'turvallisuustiedot']],
  ['fi', 'safety', T, ['varoitus', 'turvallisuusohjeet']],
  ['fi', 'type', O, ['tyyppi']],
  ['fi', 'type', T, ['malli']],
  ['fi', 'identifier', O, ['tuotetunniste']],
  ['fi', 'identifier', T, ['tuotenumero', 'tuotekoodi']],
  ['fi', 'seller', T, ['myyjä']],
  ['fi', 'stop', T, ['kuvaus', 'toimitus', 'palautukset', 'arvostelut']],

  // Swedish
  ['sv', 'manufacturer', O, ['tillverkaren', 'tillverkarens']],
  ['sv', 'manufacturer', T, ['tillverkare', 'tillverkarinformation']],
  ['sv', 'responsible', O, ['ansvariga personen']],
  ['sv', 'responsible', T, ['ansvarig person', 'ansvarig person i eu']],
  ['sv', 'importer', T, ['importör']],
  ['sv', 'representative', T, ['auktoriserad representant']],
  ['sv', 'fulfilment', O, ['leverantör av distributionstjänster']],
  ['sv', 'brand', T, ['varumärke', 'märke']],
  ['sv', 'safety', O, ['säkerhetsinformation']],
  ['sv', 'safety', T, ['varning', 'varningar', 'säkerhetsanvisningar']],
  ['sv', 'type', O, ['typ']],
  ['sv', 'type', T, ['modell']],
  ['sv', 'identifier', O, ['produktbeteckning']],
  ['sv', 'identifier', T, ['artikelnummer', 'art.nr']],
  ['sv', 'seller', T, ['säljare', 'säljs av']],
  ['sv', 'stop', T, ['beskrivning', 'leverans', 'frakt', 'returer', 'recensioner']],

  // Danish
  ['da', 'manufacturer', O, ['fabrikantens']],
  ['da', 'manufacturer', T, ['fabrikant', 'producent', 'producentoplysninger']],
  ['da', 'responsible', O, ['ansvarshavende person']],
  ['da', 'responsible', T, ['ansvarlig person', 'ansvarlig person i eu']],
  ['da', 'importer', T, ['importør']],
  ['da', 'representative', T, ['bemyndiget repræsentant']],
  ['da', 'fulfilment', O, ['udbyder af distributionstjenester']],
  ['da', 'brand', T, ['mærke', 'varemærke']],
  ['da', 'safety', O, ['advarsler', 'sikkerhedsoplysninger']],
  ['da', 'safety', T, ['advarsel', 'sikkerhedsinstruktioner']],
  ['da', 'type', O, ['type']],
  ['da', 'type', T, ['model']],
  ['da', 'identifier', O, ['produktidentifikator']],
  ['da', 'identifier', T, ['varenummer', 'varenr']],
  ['da', 'seller', T, ['sælger', 'sælges af']],
  ['da', 'stop', T, ['beskrivelse', 'levering', 'returnering', 'anmeldelser']],

  // Czech
  ['cs', 'manufacturer', O, ['výrobce']],
  ['cs', 'manufacturer', T, ['informace o výrobci']],
  ['cs', 'responsible', O, ['odpovědné osoby']],
  ['cs', 'responsible', T, ['odpovědná osoba', 'odpovědná osoba v eu']],
  ['cs', 'importer', T, ['dovozce']],
  ['cs', 'representative', T, ['zplnomocněný zástupce']],
  ['cs', 'fulfilment', O, ['poskytovatelem služeb kompletního vyřízení objednávek']],
  ['cs', 'fulfilment', T, ['poskytovatel služeb kompletního vyřízení objednávek']],
  ['cs', 'brand', T, ['značka']],
  ['cs', 'safety', O, ['bezpečnostní informace']],
  ['cs', 'safety', T, ['upozornění', 'varování', 'bezpečnostní upozornění']],
  ['cs', 'type', O, ['typu']],
  ['cs', 'type', T, ['typ', 'model']],
  ['cs', 'identifier', T, ['kód produktu', 'katalogové číslo']],
  ['cs', 'seller', T, ['prodejce', 'prodává']],
  ['cs', 'stop', T, ['popis', 'doprava', 'vrácení', 'recenze']],

  // Slovak
  ['sk', 'manufacturer', O, ['výrobca', 'výrobcu']],
  ['sk', 'manufacturer', T, ['informácie o výrobcovi']],
  ['sk', 'responsible', O, ['zodpovednej osoby']],
  ['sk', 'responsible', T, ['zodpovedná osoba', 'zodpovedná osoba v eú']],
  ['sk', 'importer', T, ['dovozca']],
  ['sk', 'representative', T, ['splnomocnený zástupca']],
  ['sk', 'fulfilment', O, ['poskytovateľ logistických služieb']],
  ['sk', 'brand', T, ['značka']],
  ['sk', 'safety', O, ['upozornenia', 'bezpečnostné pokyny']],
  ['sk', 'safety', T, ['upozornenie', 'varovanie']],
  ['sk', 'type', O, ['typu']],
  ['sk', 'type', T, ['typ', 'model']],
  ['sk', 'identifier', T, ['kód produktu', 'katalógové číslo']],
  ['sk', 'seller', T, ['predajca']],
  ['sk', 'stop', T, ['popis', 'doprava', 'vrátenie', 'recenzie']],

  // Slovenian
  ['sl', 'manufacturer', O, ['proizvajalec', 'proizvajalca']],
  ['sl', 'responsible', O, ['odgovorne osebe']],
  ['sl', 'responsible', T, ['odgovorna oseba']],
  ['sl', 'importer', T, ['uvoznik']],
  ['sl', 'representative', T, ['pooblaščeni zastopnik']],
  ['sl', 'fulfilment', O, ['ponudnik storitev odpremnih skladišč']],
  ['sl', 'brand', T, ['blagovna znamka', 'znamka']],
  ['sl', 'safety', O, ['opozorila', 'varnostne informacije']],
  ['sl', 'safety', T, ['opozorilo', 'varnostna navodila']],
  ['sl', 'type', O, ['vrsto']],
  ['sl', 'type', T, ['vrsta', 'model', 'tip']],
  ['sl', 'identifier', T, ['šifra izdelka', 'koda izdelka']],
  ['sl', 'seller', T, ['prodajalec']],
  ['sl', 'stop', T, ['opis', 'dostava', 'vračilo', 'mnenja']],

  // Croatian
  ['hr', 'manufacturer', O, ['proizvođač', 'proizvođača']],
  ['hr', 'responsible', O, ['odgovorne osobe']],
  ['hr', 'responsible', T, ['odgovorna osoba']],
  ['hr', 'importer', T, ['uvoznik']],
  ['hr', 'representative', T, ['ovlašteni zastupnik']],
  ['hr', 'fulfilment', O, ['pružatelj usluge provođenja narudžbi']],
  ['hr', 'brand', T, ['marka', 'robna marka']],
  ['hr', 'safety', O, ['upozorenja', 'informacije o sigurnosti']],
  ['hr', 'safety', T, ['upozorenje', 'sigurnosne upute']],
  ['hr', 'type', O, ['tip']],
  ['hr', 'type', T, ['model']],
  ['hr', 'identifier', T, ['šifra proizvoda', 'kod proizvoda']],
  ['hr', 'seller', T, ['prodavatelj', 'prodavač']],
  ['hr', 'stop', T, ['opis', 'dostava', 'povrat', 'recenzije']],

  // Hungarian
  ['hu', 'manufacturer', O, ['gyártó']],
  ['hu', 'manufacturer', T, ['gyártói információk', 'gyártó adatai']],
  ['hu', 'responsible', O, ['felelős személy']],
  ['hu', 'responsible', T, ['eu-ban felelős személy']],
  ['hu', 'importer', T, ['importőr']],
  ['hu', 'representative', T, ['meghatalmazott képviselő']],
  ['hu', 'fulfilment', O, ['logisztikai szolgáltató']],
  ['hu', 'brand', T, ['márka']],
  ['hu', 'safety', O, ['figyelmeztetés', 'biztonsági információ']],
  ['hu', 'safety', T, ['figyelmeztetések', 'biztonsági információk', 'biztonsági előírások']],
  ['hu', 'type', T, ['típus', 'modell']],
  ['hu', 'identifier', T, ['termékazonosító', 'cikkszám', 'termékkód']],
  ['hu', 'seller', T, ['eladó', 'forgalmazó']],
  ['hu', 'stop', T, ['leírás', 'szállítás', 'visszaküldés', 'vélemények']],

  // Romanian
  ['ro', 'manufacturer', O, ['producătorul', 'producătorului']],
  ['ro', 'manufacturer', T, ['producător', 'informații despre producător']],
  ['ro', 'responsible', O, ['persoanei responsabile']],
  ['ro', 'responsible', T, ['persoana responsabilă', 'persoană responsabilă în ue']],
  ['ro', 'importer', T, ['importator']],
  ['ro', 'representative', T, ['reprezentant autorizat']],
  ['ro', 'fulfilment', O, ['furnizor de servicii de logistică']],
  ['ro', 'brand', T, ['marcă', 'brand']],
  ['ro', 'safety', O, ['avertisment']],
  ['ro', 'safety', T, ['avertismente', 'informații de siguranță', 'instrucțiuni de siguranță']],
  ['ro', 'type', O, ['tipul']],
  ['ro', 'type', T, ['tip', 'model']],
  ['ro', 'identifier', O, ['identificator de produs']],
  ['ro', 'identifier', T, ['cod produs', 'cod articol']],
  ['ro', 'seller', T, ['vânzător', 'vândut de']],
  ['ro', 'stop', T, ['descriere', 'livrare', 'retur', 'recenzii']],

  // Bulgarian
  ['bg', 'manufacturer', O, ['производителя']],
  ['bg', 'manufacturer', T, ['производител', 'информация за производителя']],
  ['bg', 'responsible', O, ['отговорното лице']],
  ['bg', 'responsible', T, ['отговорно лице', 'отговорно лице в ес']],
  ['bg', 'importer', T, ['вносител']],
  ['bg', 'representative', T, ['упълномощен представител']],
  ['bg', 'fulfilment', O, ['доставчик на услуги за обработка на поръчки']],
  ['bg', 'brand', T, ['марка']],
  ['bg', 'safety', O, ['предупреждение', 'информация за безопасност']],
  ['bg', 'safety', T, ['предупреждения', 'инструкции за безопасност']],
  ['bg', 'type', O, ['тип']],
  ['bg', 'type', T, ['модел']],
  ['bg', 'identifier', O, ['идентификатор на продукта']],
  ['bg', 'identifier', T, ['код на продукта', 'артикулен номер']],
  ['bg', 'seller', T, ['продавач', 'продава се от']],
  ['bg', 'stop', T, ['описание', 'доставка', 'връщане', 'отзиви']],

  // Greek
  ['el', 'manufacturer', O, ['κατασκευαστής', 'κατασκευαστή']],
  ['el', 'manufacturer', T, ['στοιχεία κατασκευαστή']],
  ['el', 'responsible', O, ['υπεύθυνου προσώπου']],
  ['el', 'responsible', T, ['υπεύθυνο πρόσωπο']],
  ['el', 'importer', T, ['εισαγωγέας']],
  ['el', 'representative', T, ['εξουσιοδοτημένος αντιπρόσωπος']],
  ['el', 'fulfilment', O, ['πάροχος υπηρεσιών διεκπεραίωσης παραγγελιών']],
  ['el', 'brand', T, ['μάρκα', 'εμπορικό σήμα']],
  ['el', 'safety', O, ['προειδοποίηση', 'πληροφορίες ασφάλειας']],
  ['el', 'safety', T, ['προειδοποιήσεις', 'οδηγίες ασφαλείας']],
  ['el', 'type', T, ['τύπος', 'μοντέλο']],
  ['el', 'identifier', T, ['κωδικός προϊόντος']],
  ['el', 'seller', T, ['πωλητής']],
  ['el', 'stop', T, ['περιγραφή', 'αποστολή', 'επιστροφές', 'κριτικές']],

  // Maltese
  ['mt', 'manufacturer', O, ['manifattur']],
  ['mt', 'responsible', O, ['persuna responsabbli']],
  ['mt', 'importer', T, ['importatur']],
  ['mt', 'representative', T, ['rappreżentant awtorizzat']],
  ['mt', 'fulfilment', O, ['fornitur tas-servizzi ta\' ġestjoni']],
  ['mt', 'brand', T, ['marka']],
  ['mt', 'safety', O, ['twissija']],
  ['mt', 'safety', T, ['twissijiet', 'informazzjoni dwar is-sigurtà']],
  ['mt', 'type', O, ['tip']],
  ['mt', 'type', T, ['mudell']],
  ['mt', 'identifier', O, ['identifikatur']],
  ['mt', 'seller', T, ['bejjiegħ']],

  // Irish
  ['ga', 'manufacturer', O, ['monaróir']],
  ['ga', 'manufacturer', T, ['monaróra']],
  ['ga', 'responsible', O, ['duine atá freagrach']],
  ['ga', 'importer', T, ['allmhaireoir']],
  ['ga', 'fulfilment', O, ['soláthraí seirbhíse próiseála orduithe']],
  ['ga', 'brand', T, ['branda']],
  ['ga', 'safety', O, ['rabhadh', 'faisnéis sábháilteachta']],
  ['ga', 'type', T, ['cineál', 'samhail']],
  ['ga', 'identifier', O, ['aitheantóir táirge']],
  ['ga', 'seller', T, ['díoltóir']],
];

/** Every label phrase. */
export const LABEL_PHRASES: readonly LabelPhrase[] = Object.freeze(
  ROWS.flatMap(([lang, category, source, texts]) => texts.map((text) => Object.freeze({ text, lang, source, category }))),
);

/** The 24 official EU languages (ISO 639-1). */
export const EU_LANGUAGES: readonly string[] = Object.freeze(['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv']);

/**
 * Words that, right after a party label, show it is about something else
 * ("Manufacturer warranty", "Hersteller-Garantie", "Manufacturer part
 * number"), including the data-protection roles of a shop's privacy notice
 * ("Responsabile del trattamento", "Responsible person for data protection").
 * Used as a negative look-ahead. Maintainers' list.
 */
export const NOT_A_PARTY_FOLLOWERS =
  "(?:'s\\s+)?[-\\s]*(?:warrant\\w*|guarant\\w*|garanti\\w*|gwarancj\\w*|garantij\\w*|part\\b|product\\s+(?:number|code)|number|no\\.?(?![\\p{L}])|nr\\.?(?![\\p{L}])|nummer|code|price|preis|prix|precio|prezzo|recommend\\w*|empfehl\\w*|website|site|link" +
  "|(?:for|of|del|della|dei|degli|du|des|de|der|für|voor|van|do|da|dla|za)\\s+(?:the\\s+|den\\s+|de\\s+|il\\s+|la\\s+|los\\s+|i\\s+)?(?:data|daten\\w*|dati|données|datos|dados|gegevens|privacy|datenschutz\\w*|trattamento|traitement|tratamiento|tratamento|verwerking|protezione|protection|protección|danych|content|contenuti|inhalt\\w*|sito|webshop)" +
  "|privacy|datenschutz\\w*|data\\s+protection|gdpr|rgpd|dsgvo)";
