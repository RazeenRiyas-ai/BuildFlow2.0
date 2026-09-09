// Minimal test double for expo-constants — push-service.ts only reads expoConfig.extra.eas.projectId.
let projectId = 'test-project-id';

export function __setTestProjectId(value) {
  projectId = value;
}

export default {
  get expoConfig() {
    return { extra: { eas: { projectId } } };
  },
};
