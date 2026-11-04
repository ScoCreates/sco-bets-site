// Shared team-name normalization for SCO Bets AI.
// Keep provider aliases centralized here.

const TEAM_ALIASES = {
  // MLB
  americanleague: 'americanallstars',
  nationalleague: 'nationalallstars',

  // MLS
  chicagofire: 'chicagofirefc',
  columbuscrewsc: 'columbuscrew',
  newyorkredbulls: 'redbullnewyork',
  vancouverwhitecapsfc: 'vancouverwhitecaps',
  cfmontreal: 'cfmontral',
  losangelesfc: 'lafc',

  // Existing NCAA aliases
  gramblingsttigers: 'gramblingtigers',
  gwrevolutionaries: 'georgewashingtonrevolutionaries',
  umkckangaroos: 'kansascityroos',
  tennesseesttigers: 'tennesseestatetigers',
  murraystracers: 'murraystateracers',
  sanjosestspartans: 'sanjosestatespartans',
  georgiastpanthers: 'georgiastatepanthers',
  armyknights: 'armyblackknights',
  centralconnecticutstbluedevils: 'centralconnecticutbluedevils',
  loyolamdgreyhounds: 'loyolamarylandgreyhounds',

  // Additional NCAA basketball provider-name differences
  wrightstraiders: 'wrightstateraiders',
  americaneagles: 'americanuniversityeagles',
  arkansaslittlerocktrojans: 'littlerocktrojans',
  bostonunivterriers: 'bostonuniversityterriers',
  indianastsycamores: 'indianastatesycamores',
  jacksonsttigers: 'jacksonstatetigers',
  michiganstspartans: 'michiganstatespartans',
  mtstmarysmountaineers: 'mountstmarysmountaineers',
  stthomasmntommies: 'stthomastommies',
  semissouristredhawks: 'southeastmissouristateredhawks',
  mississippistbulldogs: 'mississippistatebulldogs',
  moreheadsteagles: 'moreheadstateeagles',
  arkansasstredwolves: 'arkansasstateredwolves',
  loyolachiramblers: 'loyolachicagoramblers',
  tennmartinskyhawks: 'utmartinskyhawks',
  texasamccislanders: 'texasamcorpuschristiislanders',
  alcornstbraves: 'alcornstatebraves',
  floridastseminoles: 'floridastateseminoles',
  chicagostcougars: 'chicagostatecougars',
  washingtonstcougars: 'washingtonstatecougars',
  gardnerwebbbulldogs: 'gardnerwebbrunninbulldogs',
  grandcanyonantelopes: 'grandcanyonlopes',
  oklahomastcowboys: 'oklahomastatecowboys',
  oklahomastcowgirls: 'oklahomastatecowgirls',
  longbeachst49ers: 'longbeachstatebeach',
  northwesternstdemons: 'northwesternstatedemons',
  oregonstbeavers: 'oregonstatebeavers',
  easttennesseestbuccaneers: 'easttennesseestatebuccaneers',
  arizonastsundevils: 'arizonastatesundevils',
  montanastbobcats: 'montanastatebobcats',
  coloradostrams: 'coloradostaterams',
  illinoisstredbirds: 'illinoisstateredbirds',
  seattleredhawks: 'seattleuredhawks',
  southernuniversityjaguars: 'southernjaguars',
  citadelbulldogs: 'thecitadelbulldogs',
  umassminutemen: 'massachusettsminutemen',
  albany: 'ualbanygreatdanes',
  liusharks: 'longislanduniversitysharks',
  youngstownstpenguins: 'youngstownstatepenguins',
  appalachianstmountaineers: 'appstatemountaineers',
  appalachianstatemountaineers: 'appstatemountaineers',
  southernmississippigoldeneagles: 'southernmissgoldeneagles',
  houstonbaptisthuskies: 'houstonchristianhuskies',
  nichollsstatecolonels: 'nichollscolonels',
  samhoustonstatebearkats: 'samhoustonbearkats',
  fortwaynemastodons: 'purduefortwaynemastodons',
  samhoustonstbearkats: 'samhoustonbearkats',
  clevelandstvikings: 'clevelandstatevikings',
  southdakotastjackrabbits: 'southdakotastatejackrabbits',
  csufullertontitans: 'calstatefullertontitans',
  kansasstwildcats: 'kansasstatewildcats',
  sandiegostaztecs: 'sandiegostateaztecs',
  southeasternlouisianalions: 'selouisianalions',
  selouisianalions: 'selouisianaladylions',
  southeasternlouisianaladylions: 'selouisianaladylions',
  mcneesestatecowboys: 'mcneesecowboys',
  unlvrebels: 'unlvladyrebels',

  // NCAA basketball abbreviations
  csunorthridgematadors: 'calstatenorthridgematadors',
  wichitastshockers: 'wichitastateshockers',
  northdakotastbison: 'northdakotastatebison'
};

export function normalizeTeamName(name) {
  const normalized = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  return TEAM_ALIASES[normalized] || normalized;
}