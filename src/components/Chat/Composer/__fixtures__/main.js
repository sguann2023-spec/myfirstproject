import './boundary.js';

// Dynamic import guarantees native/storage/network guards precede module initialization.
import('./ComposerHarness.jsx').catch((error) => {
  console.error(error);
  document.getElementById('root').textContent = `Composer fixture failed: ${error.message}`;
});
