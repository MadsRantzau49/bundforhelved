export function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

export function errorMessage(error: unknown, fallback = "Noget gik galt. Prøv igen.") {
  const message = getErrorText(error).toLowerCase();
  if (!message) return fallback;
  if (message.includes("unresolved attempt")) return "Du har allerede et aktivt forsøg.";
  if (message.includes("category is not active")) return "Kategorien er ikke længere aktiv.";
  if (message.includes("invite code not found")) return "Invitationskoden findes ikke.";
  if (message.includes("player clan membership required")) return "Den valgte spiller er ikke medlem af klanen.";
  if (message.includes("clan membership required")) return "Du er ikke medlem af klanen.";
  if (message.includes("guest access required")) return "Gæsteadgangen mangler eller er blevet fjernet.";
  if (message.includes("guest access already exists")) return "Brugeren er allerede tilføjet som gæst.";
  if (message.includes("guest user not found")) return "Brugernavnet findes ikke.";
  if (message.includes("cannot add yourself")) return "Du er allerede valgt som dig selv.";
  if (message.includes("guest request not found")) return "Anmodningen findes ikke længere eller er udløbet.";
  if (message.includes("transfer ownership")) return "Overfør ejerskabet, før du forlader klanen.";
  if (message.includes("new owner must")) return "Den nye ejer skal allerede være medlem.";
  if (message.includes("rate limit")) return "For mange forsøg. Vent lidt og prøv igen.";
  return fallback;
}
