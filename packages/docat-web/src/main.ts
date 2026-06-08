/**
 * docat Web UI — Entry Point
 */
import { createApp } from 'vue'
import router from './router/index'
import App from './App.vue'
import './styles/global.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
