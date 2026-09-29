import { mount } from 'svelte'
import App from './App.svelte'
import '../../design/tokens.css'
import './app.css'
import { requireTopLevelFrame } from '../shared/frame-guard'

if (requireTopLevelFrame()) {
  mount(App, { target: document.getElementById('app')! })
}
