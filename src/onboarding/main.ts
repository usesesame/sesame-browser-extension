import '../../design/tokens.css'
import './onboarding.css'
import App from './App.svelte'
import { mount } from 'svelte'
import { requireTopLevelFrame } from '../shared/frame-guard'

if (requireTopLevelFrame()) {
  mount(App, { target: document.getElementById('app')! })
}
