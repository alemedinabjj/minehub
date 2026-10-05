/** Human copy for auth validation/API codes (pt-BR). */
export const AUTH_ERROR_COPY: Record<string, string> = {
  EMAIL_INVALID: "Digite um e-mail válido.",
  EMAIL_TOO_LONG: "Esse e-mail é longo demais.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 10 caracteres.",
  PASSWORD_TOO_LONG: "A senha pode ter no máximo 128 caracteres.",
  NAME_TOO_SHORT: "Seu nome precisa ter pelo menos 2 letras.",
  NAME_TOO_LONG: "Esse nome está grande demais.",
  NAME_INVALID_CHARS: "Use apenas letras, números, espaço, ponto, hífen ou apóstrofo.",
  INVALID_CREDENTIALS: "E-mail ou senha incorretos.",
  EMAIL_IN_USE: "Já existe uma conta com esse e-mail. Que tal entrar?",
  RATE_LIMITED: "Muitas tentativas seguidas. Espere um minuto e tente de novo.",
  NETWORK_ERROR: "Não conseguimos falar com o HubMine. Verifique sua conexão.",
};
export const GENERIC_AUTH_ERROR = "Algo deu errado. Tente novamente em instantes.";
