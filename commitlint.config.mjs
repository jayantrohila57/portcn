const legacyNarrativeHeader = /^[A-Z][^:\r\n]*[.!?]$/;

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    (message) => {
      const header = message.split(/\r?\n/, 1)[0].trim();
      return legacyNarrativeHeader.test(header);
    },
  ],
};
