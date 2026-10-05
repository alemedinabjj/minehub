import type { Experience, PlayerBucket, Software, WorldType } from "@hubmine/shared";
import type { ProvisioningStage } from "./provisioning/derive-stages";
import type { StepError, StepId } from "./flow/types";

/** All user-facing copy for the creation journey (pt-BR). Centralized for future i18n. */

export const WORLD_TYPE_COPY: Record<WorldType, { title: string; tagline: string[]; feedback: string }> = {
  SURVIVAL: { title: "Survival", tagline: ["Explore.", "Construa.", "Sobreviva."], feedback: "Uma floresta começou a crescer." },
  PVP: { title: "PvP", tagline: ["Batalhas.", "Competição.", "Caos."], feedback: "A arena está pronta para o combate." },
  CREATIVE: { title: "Creative", tagline: ["Construa sem limites."], feedback: "Blocos flutuando, céu aberto." },
  MODDED: { title: "Modded", tagline: ["Transforme completamente o Minecraft."], feedback: "Algo diferente está surgindo." },
  SMP: { title: "SMP", tagline: ["Um mundo para jogar com sua comunidade."], feedback: "Uma vila para a sua comunidade." },
  HARDCORE: { title: "Hardcore", tagline: ["Uma vida.", "Uma chance."], feedback: "O céu escureceu. Boa sorte." },
};

export const EXPERIENCE_COPY: Record<Experience, { title: string; description: string }> = {
  VANILLA: { title: "Vanilla", description: "O Minecraft original, do jeito que a Mojang fez." },
  PERFORMANCE: { title: "Performance", description: "Mais jogadores, menos lag e suporte a plugins." },
  MODS: { title: "Mods", description: "Modifique profundamente o jogo com mods." },
  MODPACK: { title: "Modpack", description: "Uma experiência pronta, com dezenas de mods já combinados." },
};

export const SOFTWARE_COPY: Record<Software, { title: string; hint: string }> = {
  VANILLA: { title: "Vanilla", hint: "Servidor oficial" },
  PAPER: { title: "Paper", hint: "Rápido e compatível com plugins. Recomendado." },
  PURPUR: { title: "Purpur", hint: "Paper com ainda mais opções de ajuste." },
  FABRIC: { title: "Fabric", hint: "Leve e atualizado rápido. Ótimo para mods modernos." },
  NEOFORGE: { title: "NeoForge", hint: "Sucessor moderno do Forge para mods grandes." },
  FORGE: { title: "Forge", hint: "O clássico, com o maior acervo de mods antigos." },
};

export const PLAYER_COPY: Record<PlayerBucket, { title: string; detail: string }> = {
  SOLO: { title: "Só eu", detail: "Um mundo só seu" },
  SMALL: { title: "2–5 jogadores", detail: "Você e alguns amigos" },
  MEDIUM: { title: "6–10 jogadores", detail: "Um grupo animado" },
  LARGE: { title: "11–20 jogadores", detail: "Uma comunidade pequena" },
  HUGE: { title: "20+ jogadores", detail: "Uma comunidade grande" },
};

export const STEP_COPY: Record<StepId, { journeyLabel: string; eyebrow: string; title: string; subtitle?: string; cta: string }> = {
  "world-type": {
    journeyLabel: "Aventura",
    eyebrow: "Criando seu mundo",
    title: "Que tipo de mundo você quer criar?",
    subtitle: "Isso define o clima do mundo. Dá para mudar as regras depois.",
    cta: "Continuar aventura",
  },
  version: {
    journeyLabel: "Versão",
    eyebrow: "A base do seu mundo",
    title: "Qual versão vamos usar?",
    subtitle: "A recomendada é a mais compatível com mods e plugins hoje.",
    cta: "Escolher esta versão",
  },
  experience: {
    journeyLabel: "Funcionamento",
    eyebrow: "O motor do seu mundo",
    title: "Como você quer que seu mundo funcione?",
    cta: "Continuar aventura",
  },
  modpack: {
    journeyLabel: "Modpack",
    eyebrow: "Poderes extras",
    title: "Seu mundo precisa de poderes extras.",
    subtitle: "Escolha um modpack compatível com a versão escolhida.",
    cta: "Continuar aventura",
  },
  name: {
    journeyLabel: "Nome",
    eyebrow: "Seu mundo, seu nome",
    title: "Como seu mundo vai se chamar?",
    cta: "Construir meu mundo",
  },
  players: {
    journeyLabel: "Jogadores",
    eyebrow: "Quem vem junto",
    title: "Quantas pessoas vão jogar no seu mundo?",
    subtitle: "A gente calcula os recursos certos para você.",
    cta: "Continuar aventura",
  },
  summary: {
    journeyLabel: "Criar",
    eyebrow: "Tudo pronto",
    title: "Tudo pronto.",
    subtitle: "Seu mundo está esperando para nascer.",
    cta: "Criar meu mundo",
  },
};

export const STEP_ERROR_COPY: Record<StepError, string> = {
  WORLD_TYPE_REQUIRED: "Escolha um tipo de mundo para continuar.",
  VERSION_REQUIRED: "Escolha uma versão para continuar.",
  EXPERIENCE_REQUIRED: "Escolha como o seu mundo vai funcionar.",
  SOFTWARE_REQUIRED: "Escolha uma das opções de servidor.",
  MODPACK_REQUIRED: "Escolha um modpack para o seu mundo.",
  MODPACK_INCOMPATIBLE: "Esse modpack não funciona na versão escolhida. Escolha outro.",
  NAME_TOO_SHORT: "Escolha um nome com pelo menos 3 caracteres.",
  NAME_TOO_LONG: "Esse nome está grande demais. Use até 32 caracteres.",
  NAME_INVALID_CHARS: "Use apenas letras, números, espaços, hífen ou sublinhado.",
  PLAYERS_REQUIRED: "Conte pra gente quantas pessoas vão jogar.",
  EULA_REQUIRED: "Para criar o servidor, aceite o EULA do Minecraft.",
};

export const STAGE_COPY: Record<ProvisioningStage, { label: string; doing: string }> = {
  RESERVING: { label: "Reservando seu espaço", doing: "Seu pedido entrou na fila…" },
  PREPARING: { label: "Preparando o terreno", doing: "Separando endereço e espaço para o mundo…" },
  DOWNLOADING: { label: "Baixando o Minecraft", doing: "Trazendo a versão escolhida…" },
  BUILDING: { label: "Construindo o servidor", doing: "Montando o servidor com as suas escolhas…" },
  STARTING: { label: "Ligando o mundo", doing: "Gerando o mundo e iniciando o servidor…" },
  ONLINE: { label: "Online", doing: "Seu mundo está no ar." },
};

/** Maps backend error codes to human copy. Unknown codes fall back to a generic message. */
export const API_ERROR_COPY: Record<string, string> = {
  NETWORK_ERROR: "Não conseguimos falar com o HubMine. Verifique sua conexão e tente de novo.",
  VERSION_NOT_FOUND: "Essa versão não está mais disponível. Escolha outra.",
  OPERATION_IN_PROGRESS: "Já estamos trabalhando nesse mundo. Aguarde um instante.",
  QUOTA_EXCEEDED: "Você chegou ao limite de mundos do seu plano.",
  RATE_LIMITED: "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
};

export const GENERIC_ERROR = "Algo não saiu como esperado. Tente novamente em instantes.";
