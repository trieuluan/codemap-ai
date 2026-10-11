/** Some session-only model entries are listed by VS Code but cannot serve extension requests. */
export function modelUnavailableReason(model: { vendor: string; maxInputTokens: number }) {
  // The bundled CLI provider currently exposes a no-op chat/token API, including Auto.
  if (model.vendor === 'copilotcli') {
    return 'Copilot CLI models cannot answer CodeMap requests through the VS Code Language Model API. Choose a model from the copilot provider or another compatible provider.';
  }
  if (!Number.isFinite(model.maxInputTokens) || model.maxInputTokens <= 0) {
    return 'This model reports no usable input budget. Choose another VS Code model and test its connection.';
  }
  return undefined;
}
export function emptyResponseMessage(name: string) {
  return `${name} returned no text. Choose another model or use Test connection, then retry. No answer was added to conversation history.`;
}
