/**
 * Tradução de mapas, eventos e marcadores.
 *
 * ## ## ## De onde vem o inglês
 *
 * O `maps.json` do jogo **traz** nome por idioma, e o `txt()` já sabia
 * usar — os mapas aparecem certainos em pt-BR. O que é inglês são as outras
 * três camadas, e nenhuma delas passa pelo mesmo caminho:
 *
 *   - **eventos**: 13 tipos com nome em inglês ("Bird City"), referenciando o
 *     mapa pelo nome curto em inglês ("Dam", "Spaceport")
 *   - **marcadores**: 7 grupos e **182** subcategorias em `snake_case`
 *   - **tooltip** das subcategorias
 *
 * Todos chegam como string crua e eram exibidos como vinham.
 *
 * ## ## ## Por que uma tabela e não metadado no dado
 *
 * A ingestão junta ARTracker, MetaForge, RaidTheory e ARDB, e cada uma tem
 * seu próprio esquema. Traduzir na fonte significaria um dicionário por
 * fonte, e a fontes se substituem. Uma tabela só, aqui, vale para todas as
 * saídas — e o dado continua sendo o do jogo, que é o que a comunidade
 * corrige.
 *
 * As chaves são **slugs**, não nomes exibidos: `night-raid` sobrevive a uma
 * correção de nome em inglês, que `name` não sobreviveria.
 */

/** Idioma effective. `pt-BR` é o padrão do produto. */
export type Idioma = 'pt-BR' | 'en';

/**
 * ## ## ## Por que pt-BR e não `pt`
 *
 * O dump traz `pt` e `pt-BR` separados, e `pt` é **snake_case** gerado por
 * máquina: `es` e `pt` de "Riven Tides" são literalmente `mareas_divididas`
 * e `mares_partidas`. Traduzir por `pt` devolveria um identificador em vez
 * de um nome. `pt-BR` é a única das duas que é português legível.
 */
export const IDIOMA_PADRAO: Idioma = 'pt-BR';

/* ------------------------------------------------------------- 13 eventos */

/** Tipo do evento (`id` antes do `@`) -> nome por idioma. */
export const EVENTOS: Record<string, Record<Idioma, string>> = {
  'arc-frigate': { 'pt-BR': 'Fragata ARC', en: 'ARC Frigate' },
  'night-raid': { 'pt-BR': 'Raid Noturno', en: 'Night Raid' },
  matriarch: { 'pt-BR': 'Matriarca', en: 'Matriarch' },
  'bird-city': { 'pt-BR': 'Cidade das Aves', en: 'Bird City' },
  'prospecting-probes': { 'pt-BR': 'Sondas de Prospecção', en: 'Prospecting Probes' },
  beachcombing: { 'pt-BR': 'Garimpagem de Praia', en: 'Beachcombing' },
  harvester: { 'pt-BR': 'Colhedor', en: 'Harvester' },
  'lush-blooms': { 'pt-BR': 'Floração Viçosa', en: 'Lush Blooms' },
  redirection: { 'pt-BR': 'Redirecionamento', en: 'Redirection' },
  'launch-tower-loot': { 'pt-BR': 'Espólio da Torre de Lançamento', en: 'Launch Tower Loot' },
  'electromagnetic-storm': { 'pt-BR': 'Tempestade Eletromagnética', en: 'Electromagnetic Storm' },
  hurricane: { 'pt-BR': 'Hurricane', en: 'Hurricane' },
  'close-scrutiny': { 'pt-BR': 'Fiscalização Reforçada', en: 'Close Scrutiny' },
};

/* ------------------------------------------------- nome curto -> mapa base */

/**
 * Os eventos referenciam o mapa pelo **nome curto em inglês**, não pelo id.
 * Sem isto, `eventosPorChave` nunca acha nada: `chave('Dam')` é "dam" e
 * `chave('dam_battlegrounds')` é "dambattlegrounds".
 */
export const MAPA_POR_NOME_EVENTO: Record<string, string> = {
  'blue gate': 'the_blue_gate',
  'buried city': 'buried_city',
  dam: 'dam_battlegrounds',
  'pendola pass': 'pendola_pass',
  'riven tides': 'riven_tides',
  spaceport: 'the_spaceport',
  'stella montis': 'stella_montis_upper',
};

/* ------------------------------------------------------------- 7 grupos */

export const GRUPOS: Record<string, Record<Idioma, string>> = {
  containers: { 'pt-BR': 'Contêineres', en: 'Containers' },
  nature: { 'pt-BR': 'Natureza', en: 'Nature' },
  arc: { 'pt-BR': 'ARC', en: 'ARC' },
  events: { 'pt-BR': 'Eventos', en: 'Events' },
  locations: { 'pt-BR': 'Locais', en: 'Locations' },
  quests: { 'pt-BR': 'Missões', en: 'Quests' },
  other: { 'pt-BR': 'Outros', en: 'Other' },
};

/* ----------------------------------------------------- 182 subcategorias */

/**
 * Subcategoria do marcador -> nome por idioma.
 *
 * As chaves preservam o `snake_case` e o `kebab-case` originais de propósito:
 * o mesmo dado aparece nas duas grafias entre as fontes, e normalizar as chaves
 * seria trabalho sem ganho.
 *
 * ## ## ## Onde a tradução é uma estimativa
 *
 * `ARC Frigate`, `Matriarch` e `Harvester` são nomes de chefe/prop, e o
 * nome em português é escolha de tradução, não dado. Preferi manter
 * "Hurricane" e "Harvester" grafados como no original quando são usados
 * como nome próprio, em vez de inventar um equivalente que o jogador não
 * reconhece na tela. `colhedor` e `matriarca` seguem a mesma lógica em
 * minúscula.
 */
export const SUBS: Record<string, Record<Idioma, string>> = {
  // --- grafias alternativas: o mesmo slug aparece com `-` e com `_` entre as
  // fontes, e `hornet ` chega com espaco no fim. Traduzir so uma delas deixa
  // a outra em ingles na tela — foi o que o teste de cobertura pegou.
  'great-mullein': { 'pt-BR': 'Meluda', en: 'Great Mullein' },
  'prickly-pear': { 'pt-BR': 'Cacto Palma', en: 'Prickly Pear' },
  'medical-merchandise': { 'pt-BR': 'Mercadoria Médica', en: 'Medical Merchandise' },
  'communication-hideout': { 'pt-BR': 'Esconderijo de Comunicação', en: 'Communication Hideout' },
  'esr-analyzer': { 'pt-BR': 'Analisador ESR', en: 'ESR Analyzer' },
  'top-mounted-optics-retrofittings': {
    'pt-BR': 'Reequipamento de Óptica Embutida',
    en: 'Top Mounted Optics Retrofittings',
  },
  'armored-transports': { 'pt-BR': 'Transportes Blindados', en: 'Armored Transports' },
  drop_in_loot: { 'pt-BR': 'Espólio Pronto', en: 'Drop-in Loot' },
  'cold-storage': { 'pt-BR': 'Armazenamento Frio', en: 'Cold Storage' },
  'hornet ': { 'pt-BR': 'Vespa', en: 'Hornet' },
  // --- historia / quests (kebab-case)
  'a-bad-feeling': { 'pt-BR': 'Um Mau Pressentimento', en: 'A Bad Feeling' },
  'a-balanced-harvest': { 'pt-BR': 'Colheita Equilibrada', en: 'A Balanced Harvest' },
  'a-dead-end': { 'pt-BR': 'Beco sem Saída', en: 'A Dead End' },
  'a-first-foothold': { 'pt-BR': 'Primeiro Ponto de Apoio', en: 'A First Foothold' },
  'a-new-type-of-plant': { 'pt-BR': 'Um Novo Tipo de Planta', en: 'A New Type of Plant' },
  'a-path-not-yours': { 'pt-BR': 'Um Caminho que Não É Seu', en: 'A Path Not Yours' },
  'a-prime-specimen': { 'pt-BR': 'Espécime Primário', en: 'A Prime Specimen' },
  'a-rising-tide': { 'pt-BR': 'Maré Subindo', en: 'A Rising Tide' },
  'a-symbol-of-unification': { 'pt-BR': 'Símbolo de Unificação', en: 'A Symbol of Unification' },
  'a-toxic-trail': { 'pt-BR': 'Trilha Tóxica', en: 'A Toxic Trail' },
  'a-warm-place-to-rest': { 'pt-BR': 'Um Lugar Quente para Descansar', en: 'A Warm Place to Rest' },
  'after-rain-comes': { 'pt-BR': 'Depois da Chuva', en: 'After Rain Comes' },
  'back-on-top': { 'pt-BR': 'De Volta ao Topo', en: 'Back on Top' },
  'battening-down': { 'pt-BR': 'Firmando as Posições', en: 'Battening Down' },
  'belly-of-the-beast': { 'pt-BR': 'Ventre da Fera', en: 'Belly of the Beast' },
  'building-a-library': { 'pt-BR': 'Construindo uma Biblioteca', en: 'Building a Library' },
  'broken-monument': { 'pt-BR': 'Monumento Quebrado', en: 'Broken Monument' },
  'clamoring-for-attention': { 'pt-BR': 'Implorando Atenção', en: 'Clamoring for Attention' },
  'clean-hands': { 'pt-BR': 'Mãos Limpas', en: 'Clean Hands' },
  'celestes-childhood-drawings': { 'pt-BR': 'Desenhos de Infância de Celeste', en: "Celeste's Childhood Drawings" },
  'celestes-journals': { 'pt-BR': 'Diários de Celeste', en: "Celeste's Journals" },
  'celestes-teenage-rebellion': { 'pt-BR': 'Rebeldia Adolescente de Celeste', en: "Celeste's Teenage Rebellion" },
  'combat-recon': { 'pt-BR': 'Reconhecimento de Combate', en: 'Combat Recon' },
  'digging-up-dirt': { 'pt-BR': 'Escavando a Terra', en: 'Digging Up Dirt' },
  'dormant-barons': { 'pt-BR': 'Barões Dormentes', en: 'Dormant Barons' },
  'down-to-earth': { 'pt-BR': 'Com os Pés no Chão', en: 'Down to Earth' },
  'drop-in-loot': { 'pt-BR': 'Espólio Pronto', en: 'Drop-in Loot' },
  'echoes-of-victory-ridge': { 'pt-BR': 'Ecos da Crista da Vitória', en: 'Echoes of Victory Ridge' },
  'escaping-the-furnace': { 'pt-BR': 'Escapando da Fornalha', en: 'Escaping the Furnace' },
  'exploring-pendola-pass': { 'pt-BR': 'Explorando a Passagem Pendola', en: 'Exploring Pendola Pass' },
  'eyes-in-the-sky': { 'pt-BR': 'Olhos no Céu', en: 'Eyes in the Sky' },
  'eyes-on-the-prize': { 'pt-BR': 'Foco no Prêmio', en: 'Eyes on the Prize' },
  'flickering-threat': { 'pt-BR': 'Ameaça Instável', en: 'Flickering Threat' },
  'fragmented-logs': { 'pt-BR': 'Registros Fragmentados', en: 'Fragmented Logs' },
  'furtive-meetings': { 'pt-BR': 'Encontros Clandestinos', en: 'Furtive Meetings' },
  'greasing-her-palms': { 'pt-BR': 'Engraxando as Mãos', en: 'Greasing Her Palms' },
  'groundbreaking': { 'pt-BR': 'Revolucionário', en: 'Groundbreaking' },
  'hatch-repairs': { 'pt-BR': 'Reparos na Eclosão', en: 'Hatch Repairs' },
  'home-to-roost': { 'pt-BR': 'De Volta ao Poleiro', en: 'Home to Roost' },
  'in-my-image': { 'pt-BR': 'À Minha Imagem', en: 'In My Image' },
  'industrial-espionage': { 'pt-BR': 'Espionagem Industrial', en: 'Industrial Espionage' },
  'keeping-an-eye-out': { 'pt-BR': 'De Olho', en: 'Keeping an Eye Out' },
  'keeping-the-memory': { 'pt-BR': 'Preservando a Memória', en: 'Keeping the Memory' },
  'last-entry': { 'pt-BR': 'Última Entrada', en: 'Last Entry' },
  'life-of-a-pharmacist': { 'pt-BR': 'Vida de Farmacêutico', en: 'Life of a Pharmacist' },
  'line-in-the-sand': { 'pt-BR': 'Linha na Areia', en: 'Line in the Sand' },
  'marked-for-death': { 'pt-BR': 'Marcado para Morrer', en: 'Marked for Death' },
  'market-correction': { 'pt-BR': 'Correção de Mercado', en: 'Market Correction' },
  'movie-night': { 'pt-BR': 'Noite de Cinema', en: 'Movie Night' },
  'off-the-raider': { 'pt-BR': 'Contra o Raider', en: 'Off the Raider' },
  'on-deaf-ears': { 'pt-BR': 'Surdo a Pedidos', en: 'On Deaf Ears' },
  'our-presence-up-there': { 'pt-BR': 'Nossa Presença Ali em Cima', en: 'Our Presence Up There' },
  'outstanding-balance': { 'pt-BR': 'Saldo Pendente', en: 'Outstanding Balance' },
  'paving-the-way': { 'pt-BR': 'Abrindo Caminho', en: 'Paving the Way' },
  'picking-up-the-pieces': { 'pt-BR': 'Juntando os Pedaços', en: 'Picking Up the Pieces' },
  'reduced-to-rubble': { 'pt-BR': 'Reduzido a Escombros', en: 'Reduced to Rubble' },
  'ruins-and-reverberations': { 'pt-BR': 'Ruínas e Reverberações', en: 'Ruins and Reverberations' },
  'safe-harbor': { 'pt-BR': 'Porto Seguro', en: 'Safe Harbor' },
  'shoring-up-defenses': { 'pt-BR': 'Reforçando as Defesas', en: 'Shoring Up Defenses' },
  'sizing-things-up': { 'pt-BR': 'Medindo as Coisas', en: 'Sizing Things Up' },
  'snap-and-salvage': { 'pt-BR': 'Fotografe e Recupere', en: 'Snap and Salvage' },
  'someone-elses-shoes': { 'pt-BR': 'Sapatos de Outro', en: "Someone Else's Shoes" },
  'source-of-the-contamination': { 'pt-BR': 'Origem da Contaminação', en: 'Source of the Contamination' },
  'sprint-shooting': { 'pt-BR': 'Corrida e Tiro', en: 'Sprint Shooting' },
  'stable-housing': { 'pt-BR': 'Moradia Estável', en: 'Stable Housing' },
  'straight-record': { 'pt-BR': 'Bijeira Limpa', en: 'Straight Record' },
  'taking-stock': { 'pt-BR': 'Fazendo o Inventário', en: 'Taking Stock' },
  'the-clean-dream': { 'pt-BR': 'O Sonho Limpo', en: 'The Clean Dream' },
  'the-first-nomads': { 'pt-BR': 'Os Primeiros Nôades', en: 'The First Nomads' },
  'the-league': { 'pt-BR': 'A Liga', en: 'The League' },
  'the-majors-footlocker': { 'pt-BR': 'O Armário do Chefe', en: "The Major's Foot Locker" },
  'the-root-of-the-matter': { 'pt-BR': 'A Raiz do Assunto', en: 'The Root of the Matter' },
  'to-the-skies': { 'pt-BR': 'Aos Céus', en: 'To the Skies' },
  'tracks-of-the-beast': { 'pt-BR': 'Rastros da Fera', en: 'Tracks of the Beast' },
  'unexpected-initiative': { 'pt-BR': 'Iniciativa Inesperada', en: 'Unexpected Initiative' },
  'untended-garden': { 'pt-BR': 'Jardim Sem Cuidado', en: 'Untended Garden' },
  'water-troubles': { 'pt-BR': 'Dificuldades com Água', en: 'Water Troubles' },
  'what-we-left-behind': { 'pt-BR': 'O que Deixamos Para Trás', en: 'What We Left Behind' },
  'wires-crossed': { 'pt-BR': 'Fios Cruzados', en: 'Wires Crossed' },
  'with-a-trace': { 'pt-BR': 'Com Rastro', en: 'With a Trace' },
  'with-a-view': { 'pt-BR': 'Com Vista', en: 'With a View' },

  // --- props (snake_case)
  agave: { 'pt-BR': 'Agave', en: 'Agave' },
  ammo_crate: { 'pt-BR': 'Caixa de Munição', en: 'Ammo Crate' },
  android: { 'pt-BR': 'Andrôide', en: 'Android' },
  antenna: { 'pt-BR': 'Antena', en: 'Antenna' },
  apricot: { 'pt-BR': 'Damasco', en: 'Apricot' },
  arc_courier: { 'pt-BR': 'Courier da ARC', en: 'ARC Courier' },
  arc_husk: { 'pt-BR': 'Casca da ARC', en: 'ARC Husk' },
  arc_probe: { 'pt-BR': 'Sonda da ARC', en: 'ARC Probe' },
  armored_transports: { 'pt-BR': 'Transportes Blindados', en: 'Armored Transports' },
  assessor: { 'pt-BR': 'Avaliador', en: 'Assessor' },
  bag: { 'pt-BR': 'Saco', en: 'Bag' },
  baron_husk: { 'pt-BR': 'Casca do Barão', en: 'Baron Husk' },
  base_container: { 'pt-BR': 'Contêiner Base', en: 'Base Container' },
  basket: { 'pt-BR': 'Cesto', en: 'Basket' },
  bastion: { 'pt-BR': 'Bastião', en: 'Bastion' },
  bees: { 'pt-BR': 'Abelhas', en: 'Bees' },
  bird: { 'pt-BR': 'Pássaro', en: 'Bird' },
  bison: { 'pt-BR': 'Bisão', en: 'Bison' },
  bombardier: { 'pt-BR': 'Bombardeiro', en: 'Bombardier' },
  box: { 'pt-BR': 'Caixa', en: 'Box' },
  breach_room: { 'pt-BR': 'Sala de Invasão', en: 'Breach Room' },
  breachable_container: { 'pt-BR': 'Contêiner Invadível', en: 'Breachable Container' },
  bully: { 'pt-BR': 'Valentão', en: 'Bully' },
  button: { 'pt-BR': 'Botão', en: 'Button' },
  calibrated_transmitter: { 'pt-BR': 'Transmissor Calibrado', en: 'Calibrated Transmitter' },
  candleberries: { 'pt-BR': 'Candeeiros', en: 'Candleberries' },
  car: { 'pt-BR': 'Carro', en: 'Car' },
  car_alarm: { 'pt-BR': 'Alarme do Carro', en: 'Car Alarm' },
  carrier_hatch: { 'pt-BR': 'Porta do Transporte', en: 'Carrier Hatch' },
  cold_storage: { 'pt-BR': 'Armazenamento Frio', en: 'Cold Storage' },
  combat_supplies: { 'pt-BR': 'Suprimentos de Combate', en: 'Combat Supplies' },
  comet: { 'pt-BR': 'Cometa', en: 'Comet' },
  communication_hideout: { 'pt-BR': 'Esconderijo de Comunicação', en: 'Communication Hideout' },
  deforester_husk: { 'pt-BR': 'Casca do Destruidor de Florestas', en: 'Deforester Husk' },
  dig_spot: { 'pt-BR': 'Local de Escavação', en: 'Dig Spot' },
  dormant_barons: { 'pt-BR': 'Barões Dormentes', en: 'Dormant Barons' },
  emergency_shelter: { 'pt-BR': 'Abrigo de Emergência', en: 'Emergency Shelter' },
  emperor_payload: { 'pt-BR': 'Carga do Imperador', en: 'Emperor Payload' },
  espresso: { 'pt-BR': 'Espresso', en: 'Espresso' },
  esr_analyzer: { 'pt-BR': 'Analisador ESR', en: 'ESR Analyzer' },
  extraction: { 'pt-BR': 'Extração', en: 'Extraction' },
  fertilizer: { 'pt-BR': 'Fertilizante', en: 'Fertilizer' },
  field_crate: { 'pt-BR': 'Caixa de Campo', en: 'Field Crate' },
  field_depot: { 'pt-BR': 'Depósito de Campo', en: 'Field Depot' },
  fireball: { 'pt-BR': 'Esfera de Fogo', en: 'Fireball' },
  firefly: { 'pt-BR': 'Vaga-lume', en: 'Firefly' },
  flash_freeze: { 'pt-BR': 'Congelamento Súbito', en: 'Flash Freeze' },
  frigate_cargo: { 'pt-BR': 'Carga da Fragata', en: 'Frigate Cargo' },
  frozen_raider_cache: { 'pt-BR': 'Depósito Congelado', en: 'Frozen Raider Cache' },
  'fuel-cell': { 'pt-BR': 'Célula de Combustível', en: 'Fuel Cell' },
  gondola_landing: { 'pt-BR': 'Pouso da Gôndola', en: 'Gondola Landing' },
  great_mullein: { 'pt-BR': 'Meluda', en: 'Great Mullein' },
  harvester: { 'pt-BR': 'Colhedor', en: 'Harvester' },
  hatch: { 'pt-BR': 'Eclosão', en: 'Hatch' },
  hornet: { 'pt-BR': 'Vespa', en: 'Hornet' },
  hurricane_cache: { 'pt-BR': 'Depósito do Furacão', en: 'Hurricane Cache' },
  hydra: { 'pt-BR': 'Hidra', en: 'Hydra' },
  lemons: { 'pt-BR': 'Limões', en: 'Lemons' },
  locked_gate_key: { 'pt-BR': 'Chave do Portão', en: 'Locked Gate Key' },
  locked_room: { 'pt-BR': 'Sala Trancada', en: 'Locked Room' },
  locker: { 'pt-BR': 'Armário', en: 'Locker' },
  mast_lift: { 'pt-BR': 'Elevador do Mastro', en: 'Mast Lift' },
  matriarch: { 'pt-BR': 'Matriarca', en: 'Matriarch' },
  med_crate: { 'pt-BR': 'Caixa Médica', en: 'Med Crate' },
  medical_merchandise: { 'pt-BR': 'Mercadoria Médica', en: 'Medical Merchandise' },
  metro_entrance: { 'pt-BR': 'Entrada do Metrô', en: 'Metro Entrance' },
  metro_station: { 'pt-BR': 'Estação do Metrô', en: 'Metro Station' },
  mine: { 'pt-BR': 'Mina', en: 'Mine' },
  moss: { 'pt-BR': 'Musgo', en: 'Moss' },
  mountaineers_detector: { 'pt-BR': 'Detector de Montanhistas', en: "Mountaineer's Detector" },
  mushroom: { 'pt-BR': 'Cogumelo', en: 'Mushroom' },
  olive: { 'pt-BR': 'Azeitona', en: 'Olive' },
  piano: { 'pt-BR': 'Piano', en: 'Piano' },
  player_spawn: { 'pt-BR': 'Ponto de Nascimento', en: 'Player Spawn' },
  pop: { 'pt-BR': 'Pop', en: 'Pop' },
  prickly_pear: { 'pt-BR': 'Cacto Palma', en: 'Prickly Pear' },
  puzzle_button: { 'pt-BR': 'Botão do Enigma', en: 'Puzzle Button' },
  queen: { 'pt-BR': 'Rainha', en: 'Queen' },
  raider_cache: { 'pt-BR': 'Depósito de Raider', en: 'Raider Cache' },
  raider_camp: { 'pt-BR': 'Acampamento de Raider', en: 'Raider Camp' },
  rocketeer: { 'pt-BR': 'Foguetinho', en: 'Rocketeer' },
  rocketeer_husk: { 'pt-BR': 'Casca do Foguetinho', en: 'Rocketeer Husk' },
  rollbot: { 'pt-BR': 'Rollbot', en: 'Rollbot' },
  roots: { 'pt-BR': 'Raízes', en: 'Roots' },
  security_breach: { 'pt-BR': 'Violação de Segurança', en: 'Security Breach' },
  security_camera: { 'pt-BR': 'Câmera de Segurança', en: 'Security Camera' },
  sentinel: { 'pt-BR': 'Sentinela', en: 'Sentinel' },
  ship_model: { 'pt-BR': 'Modelo de Navio', en: 'Ship Model' },
  shredder: { 'pt-BR': 'Triturador', en: 'Shredder' },
  skulker: { 'pt-BR': 'Espreitador', en: 'Skulker' },
  snitch: { 'pt-BR': 'Delator', en: 'Snitch' },
  snow_pile: { 'pt-BR': 'Pilha de Neve', en: 'Snow Pile' },
  supply_station: { 'pt-BR': 'Estação de Suprimentos', en: 'Supply Station' },
  tick: { 'pt-BR': 'Carrapato', en: 'Tick' },
  turbine: { 'pt-BR': 'Turbina', en: 'Turbine' },
  turret: { 'pt-BR': 'Torreta', en: 'Turret' },
  utility_crate: { 'pt-BR': 'Caixa de Utilidade', en: 'Utility Crate' },
  vaporizer: { 'pt-BR': 'Vaporizador', en: 'Vaporizer' },
  wasp: { 'pt-BR': 'Vespa', en: 'Wasp' },
  wasp_husk: { 'pt-BR': 'Casca de Vespa', en: 'Wasp Husk' },
  weapon_case: { 'pt-BR': 'Caixa de Armas', en: 'Weapon Case' },
  zipline: { 'pt-BR': 'Tirolesa', en: 'Zipline' },
};

/* ------------------------------------------------------------- funções */

/** Normaliza para comparar slugs: minúsculo, sem `_`, `-` ou espaço. */
const chave = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Nome do evento por idioma.
 *
 * Aceita o `id` completo (`bird-city@1791846000000`) e usa a parte antes do
 * `@`, que é o **tipo**. Usar o `name` como chave não funcionaria: o nome vem
 * em inglês e mudar a grafia dele na fonte quebraria a tradução, enquanto o
 * id é estável.
 */
export function nomeEvento(id: unknown, nome: unknown, idioma: Idioma = IDIOMA_PADRAO): string {
  const base = String(id ?? '').split('@')[0] ?? '';
  const t = EVENTOS[base];
  if (t) return t[idioma];
  const porNome = Object.entries(EVENTOS).find(([, v]) => v.en === String(nome ?? ''));
  if (porNome) return porNome[1][idioma];
  return String(nome ?? '') || base;
}

/** Id canônico do mapa a partir do nome curto que o evento traz. */
/**
 * Índice da tabela de mapa, com a **mesma** normalização da busca.
 *
 * A primeira versão guardava a tabela com espaço (`'blue gate'`) e procurava
 * pela chave normalizada (`bluegate`) — 2 de 7 resolvidos, e o erro era
 * silencioso: o evento simplesmente não aparecia na lista do mapa.
 */
const MAPA_POR_NOME_NORMALIZADO: Map<string, string> = new Map(
  Object.entries(MAPA_POR_NOME_EVENTO).map(([k, v]) => [chave(k), v]),
);

export function mapaDoEvento(mapa: unknown): string | null {
  return MAPA_POR_NOME_NORMALIZADO.get(chave(String(mapa ?? ''))) ?? null;
}

export function nomeGrupo(g: string, idioma: Idioma = IDIOMA_PADRAO): string {
  return GRUPOS[g]?.[idioma] ?? g;
}

export function nomeSub(s: string, idioma: Idioma = IDIOMA_PADRAO): string {
  return SUBS[s]?.[idioma] ?? s.replace(/[_-]+/g, ' ');
}

/**
 * Cobertura da tabela.
 *
 * Existe porque a lista de subcategorias **cresce** com o conteúdo do jogo, e
 * uma sub nova apareceria em inglês sem nenhum aviso. Isto é o alarme.
 */
export function coberturaSub(presentes: Iterable<string>): { traduzidas: number; faltando: string[] } {
  const faltando: string[] = [];
  let traduzidas = 0;
  for (const s of presentes) {
    if (SUBS[s]) traduzidas++;
    else faltando.push(s);
  }
  return { traduzidas, faltando };
}