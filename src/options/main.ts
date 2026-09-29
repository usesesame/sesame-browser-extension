import { mount } from 'svelte'
import App from './App.svelte'
import '../../design/tokens.css'
import './options.css'
import { requireTopLevelFrame } from '../shared/frame-guard'

if (requireTopLevelFrame()) {
  mount(App, { target: document.getElementById('app')! })
}
