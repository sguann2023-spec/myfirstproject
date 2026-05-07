import React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';

import store, { persistor } from '@renderer/store';
import { ThemeProvider } from '@renderer/context/ThemeProvider';
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider';

import HomePage from './HomePage.jsx';

const HomePageShell = () => {
  return (
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <ThemeProvider>
          <CodeStyleProvider>
            <HomePage />
          </CodeStyleProvider>
        </ThemeProvider>
      </PersistGate>
    </Provider>
  );
};

export default HomePageShell;
