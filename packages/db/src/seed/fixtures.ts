import type { CreatorPlatform } from "@creator-outdoor/domain";

export type CategoryFixture = {
  readonly slug: string;
  readonly name: string;
  readonly isActive: boolean;
};

/** The launch catalogue. Only `musica` is active at launch. */
export const CATEGORY_FIXTURES: readonly CategoryFixture[] = [
  { slug: "tecnologia", name: "Tecnologia", isActive: false },
  { slug: "games", name: "Games", isActive: false },
  { slug: "musica", name: "Música", isActive: true },
  { slug: "moda", name: "Moda", isActive: false },
  { slug: "beleza", name: "Beleza", isActive: false },
  { slug: "fitness", name: "Fitness", isActive: false },
  { slug: "comida", name: "Comida", isActive: false },
  { slug: "educacao", name: "Educação", isActive: false },
  { slug: "comedia", name: "Comédia", isActive: false },
  { slug: "arte", name: "Arte", isActive: false },
  { slug: "lifestyle", name: "Lifestyle", isActive: false },
  { slug: "negocios", name: "Negócios", isActive: false },
  { slug: "outros", name: "Outros", isActive: false },
];

export type CreatorFixture = {
  readonly slug: string;
  readonly displayName: string;
  readonly handle: string;
  readonly platform: CreatorPlatform;
  readonly bio: string;
  readonly categorySlug: string;
  /** Total confirmed boosts inside the current weekly period, in centavos. */
  readonly currentWeekCents: number;
  /** Total confirmed boosts across the six preceding weeks, in centavos. */
  readonly historicalCents: number;
  /** Days before today the creator joined Creator Outdoor. */
  readonly joinedDaysAgo: number;
};

/**
 * Fifteen invented creators.
 *
 * These are fictional personas, never real people: seeding a live public figure
 * would put a real profile on a public money ranking without their knowledge.
 *
 * The two leading amounts reproduce the documented Take #1 example — a R$487
 * leader and a R$393 challenger quote R$95.
 */
export const CREATOR_FIXTURES: readonly CreatorFixture[] = [
  {
    slug: "luna-verso",
    displayName: "Luna Verso",
    handle: "lunaverso",
    platform: "YOUTUBE",
    bio: "Canções de quarto gravadas em fita e postadas toda quinta.",
    categorySlug: "musica",
    currentWeekCents: 48_700,
    historicalCents: 132_400,
    joinedDaysAgo: 210,
  },
  {
    slug: "mara-beats",
    displayName: "Mara Beats",
    handle: "marabeats",
    platform: "SPOTIFY",
    bio: "Batidas de baile misturadas ao vivo, sem repetir set.",
    categorySlug: "musica",
    currentWeekCents: 39_300,
    historicalCents: 218_900,
    joinedDaysAgo: 245,
  },
  {
    slug: "rafa-onda",
    displayName: "Rafa Onda",
    handle: "rafaonda",
    platform: "INSTAGRAM",
    bio: "Guitarra surf e reverb litorâneo direto do Recife.",
    categorySlug: "musica",
    currentWeekCents: 28_600,
    historicalCents: 96_700,
    joinedDaysAgo: 180,
  },
  {
    slug: "coral-do-beco",
    displayName: "Coral do Beco",
    handle: "coraldobeco",
    platform: "YOUTUBE",
    bio: "Doze vozes ensaiando na escadaria todo domingo de manhã.",
    categorySlug: "musica",
    currentWeekCents: 21_400,
    historicalCents: 74_300,
    joinedDaysAgo: 320,
  },
  {
    slug: "teo-baiao",
    displayName: "Téo Baião",
    handle: "teobaiao",
    platform: "TIKTOK",
    bio: "Forró pé de serra em vídeos de trinta segundos.",
    categorySlug: "musica",
    currentWeekCents: 17_800,
    historicalCents: 41_200,
    joinedDaysAgo: 96,
  },
  {
    slug: "nina-reverb",
    displayName: "Nina Reverb",
    handle: "ninareverb",
    platform: "TWITCH",
    bio: "Produção ao vivo: uma faixa inteira por transmissão.",
    categorySlug: "musica",
    currentWeekCents: 14_200,
    historicalCents: 58_600,
    joinedDaysAgo: 150,
  },
  {
    slug: "bloco-zabumba",
    displayName: "Bloco Zabumba",
    handle: "blocozabumba",
    platform: "INSTAGRAM",
    bio: "Percussão de rua ensaiada em praça pública desde 2019.",
    categorySlug: "musica",
    currentWeekCents: 11_500,
    historicalCents: 129_800,
    joinedDaysAgo: 400,
  },
  {
    slug: "vito-cordas",
    displayName: "Vito Cordas",
    handle: "vitocordas",
    platform: "SPOTIFY",
    bio: "Viola caipira e arranjos instrumentais lançados mensalmente.",
    categorySlug: "musica",
    currentWeekCents: 9_800,
    historicalCents: 33_100,
    joinedDaysAgo: 260,
  },
  {
    slug: "sol-de-abril",
    displayName: "Sol de Abril",
    handle: "soldeabril",
    platform: "YOUTUBE",
    bio: "MPB nova com letras escritas em ônibus interestadual.",
    categorySlug: "musica",
    currentWeekCents: 7_600,
    historicalCents: 87_500,
    joinedDaysAgo: 138,
  },
  {
    slug: "kaya-frequencia",
    displayName: "Kaya Frequência",
    handle: "kayafrequencia",
    platform: "SPOTIFY",
    bio: "Dub eletrônico e graves construídos em casa.",
    categorySlug: "musica",
    currentWeekCents: 5_400,
    historicalCents: 22_700,
    joinedDaysAgo: 72,
  },
  {
    slug: "pedro-sanfona",
    displayName: "Pedro Sanfona",
    handle: "pedrosanfona",
    platform: "TIKTOK",
    bio: "Sanfona de oito baixos ensinada em aulas curtas.",
    categorySlug: "musica",
    currentWeekCents: 4_300,
    historicalCents: 15_900,
    joinedDaysAgo: 54,
  },
  {
    slug: "ori-sintetizado",
    displayName: "Ori Sintetizado",
    handle: "orisintetizado",
    platform: "TWITCH",
    bio: "Sintetizadores modulares em transmissões de madrugada.",
    categorySlug: "musica",
    currentWeekCents: 3_100,
    historicalCents: 61_200,
    joinedDaysAgo: 310,
  },
  {
    slug: "bia-metronomo",
    displayName: "Bia Metrônomo",
    handle: "biametronomo",
    platform: "X",
    bio: "Bateria e estudos de ritmo comentados em fio semanal.",
    categorySlug: "musica",
    currentWeekCents: 2_200,
    historicalCents: 9_400,
    joinedDaysAgo: 45,
  },
  {
    slug: "grupo-mare-alta",
    displayName: "Grupo Maré Alta",
    handle: "grupomarealta",
    platform: "INSTAGRAM",
    bio: "Samba de roda gravado na varanda, com convidados.",
    categorySlug: "musica",
    currentWeekCents: 1_500,
    historicalCents: 44_800,
    joinedDaysAgo: 275,
  },
  {
    slug: "sabia-eletrico",
    displayName: "Sabiá Elétrico",
    handle: "sabiaeletrico",
    platform: "SUBSTACK",
    bio: "Cartas sobre música brasileira com uma faixa inédita por edição.",
    categorySlug: "musica",
    currentWeekCents: 800,
    historicalCents: 5_200,
    joinedDaysAgo: 30,
  },
];

export const SUPPORTER_NAMES: readonly string[] = [
  "Marina",
  "Caio",
  "Bel",
  "Tuca",
  "Joana",
  "Rafa",
  "Dora",
  "Ivo",
  "Lena",
  "Chico",
  "Sofia",
  "Nando",
  "Alice",
  "Tomás",
  "Vera",
  "Gui",
  "Cecília",
  "Otto",
];

export const SUPPORTER_MESSAGES: readonly string[] = [
  "Vamos pro topo.",
  "Merece muito mais gente ouvindo.",
  "Toda semana eu volto aqui.",
  "Descobri ontem e já virei fã.",
  "A torcida não dorme.",
  "Segura o primeiro lugar!",
  "Esse som tocou o dia inteiro.",
  "Chamei a galera toda.",
];
