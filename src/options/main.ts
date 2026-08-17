import { mount } from 'svelte'
import App from './App.svelte'
import '../../design/tokens.css'
import './options.css'

mount(App, { target: document.getElementById('app')! })
