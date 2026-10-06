import { testOrigin } from './test-origin';

export const resetStorage = async () => {
  return fetch(`${testOrigin()}/e2e/reset-storage`, {
    method: 'POST',
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Failed to reset storage: ${res.statusText}`);
    }

    return res.json();
  });
};
