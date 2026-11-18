// オフラインでも使える主要企業の入力候補。網羅的な企業名簿・採用情報ではない。
const CATALOG = [
  ['トヨタ自動車', 'とよた toyota'], ['ソニーグループ', 'そにー sony'], ['ソニー', 'そにー sony'],
  ['任天堂', 'にんてんどう nintendo'], ['楽天グループ', 'らくてん rakuten'], ['リクルート', 'りくるーと recruit'],
  ['サイバーエージェント', 'さいばー cyberagent'], ['LINEヤフー', 'らいん やふー line yahoo'],
  ['ソフトバンク', 'そふとばんく softbank'], ['NTTデータ', 'えぬてぃーてぃー ntt'], ['NTTドコモ', 'どこも docomo'],
  ['KDDI', 'けーでぃーでぃーあい au'], ['富士通', 'ふじつう fujitsu'], ['日本電気（NEC）', 'にっぽんでんき えぬいーしー nec'],
  ['日立製作所', 'ひたち hitachi'], ['パナソニック', 'ぱなそにっく panasonic'], ['本田技研工業', 'ほんだ honda'],
  ['日産自動車', 'にっさん nissan'], ['三菱商事', 'みつびししょうじ mitsubishi'], ['三井物産', 'みついぶっさん mitsui'],
  ['伊藤忠商事', 'いとうちゅう itochu'], ['住友商事', 'すみともしょうじ sumitomo'], ['丸紅', 'まるべに marubeni'],
  ['三菱UFJ銀行', 'みつびし ゆーえふじぇい mufg'], ['三井住友銀行', 'みついすみとも smbc'], ['みずほ銀行', 'みずほ mizuho'],
  ['野村證券', 'のむら nomura'], ['東京海上日動火災保険', 'とうきょうかいじょう'], ['日本生命保険', 'にほんせいめい'],
  ['全日本空輸（ANA）', 'ぜんにっくう あな ana'], ['日本航空（JAL）', 'にほんこうくう じゃる jal'],
  ['東日本旅客鉄道（JR東日本）', 'じぇいあーる ひがしにほん jr'], ['資生堂', 'しせいどう shiseido'],
  ['花王', 'かおう kao'], ['味の素', 'あじのもと ajinomoto'], ['サントリー', 'さんとりー suntory'],
  ['明治', 'めいじ meiji'], ['キリンホールディングス', 'きりん kirin'], ['アサヒビール', 'あさひ asahi'],
  ['ファーストリテイリング', 'ふぁーすと りていりんぐ ゆにくろ uniqlo'], ['良品計画', 'りょうひん むじ muji'],
  ['ニトリ', 'にとり nitori'], ['イオン', 'いおん aeon'], ['アクセンチュア', 'あくせんちゅあ accenture'],
  ['デロイト トーマツ コンサルティング', 'でろいと とーまつ deloitte'], ['PwCコンサルティング', 'ぴーだぶりゅーしー pwc'],
  ['日本IBM', 'にほん あいびーえむ ibm'], ['日本マイクロソフト', 'まいくろそふと microsoft'],
  ['グーグル', 'ぐーぐる google'], ['アマゾンジャパン', 'あまぞん amazon'], ['電通', 'でんつう dentsu'], ['博報堂', 'はくほうどう hakuhodo'],
];
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function companySuggestions(query: string, registered: string[]): string[] {
  const q = fold(query.trim());
  if (!q) return [];
  const choices = [...registered.map(name => [name, '']), ...CATALOG];
  return [...new Set(choices.filter(([name, aliases]) => fold(name + ' ' + aliases).includes(q)).map(([name]) => name))].slice(0, 8);
}
export function gmailUrl(company: string) {
  const term = company.replace(/["\\]/g, ' ').trim();
  return 'https://mail.google.com/mail/#search/' + encodeURIComponent('"' + term + '"');
}
// 改行は除外、空白・句読点を含むUnicodeコードポイント数。
export const characterCount = (text: string) => Array.from(text.replace(/[\r\n]/g, '')).length;
