import React from 'react';
import ReactDOM from 'react-dom';
import App from './component/App';
import './index.css'
import './protocol/index'
import { store } from './reducer';
import { Provider } from 'react-redux';
import './utils/relocalStorage'
import './utils/i18n'
ReactDOM.render(
  <Provider store={store}><App /></Provider>,
  document.getElementById('App')
);
