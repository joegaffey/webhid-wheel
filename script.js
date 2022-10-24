import { Wheel } from './webhid-wheel.js';    

let wheelEl, wheelNameEl, debugEl, buttonShapes, axisShapes;

// The WebHID device can only be requested upon user interaction
document.getElementById('connectButton').addEventListener('click', async () => {
  
  const wheel = new Wheel();
  
  // This will request the WebHID device and initialize the controller
  await wheel.init();
  
  function logInputs() {
    requestAnimationFrame(logInputs);   
    
    if(wheel.name)
      wheelNameEl.innerHTML = wheel.name;
    
    if(wheel.debug)
      debugEl.innerHTML = wheel.debug.join('<br/>');
        
    if(wheel.rotation)
      wheelEl.setAttribute('transform', `rotate(${wheel.rotation})`);
    if(wheel.buttons) {
      wheel.buttons.forEach((button, i) => {
        button ? buttonShapes[i].setAttribute('fill', 'red') : buttonShapes[i].setAttribute('fill', 'none');
      });
    }
    if(wheel.axes) {
      wheel.axes.forEach((axis, i) => {
        axisShapes[i].setAttribute('height', axis / 255 * 50);
      });
    }
  }
  logInputs();  
  
  const rumbleInput = document.getElementById('rumble');
  rumbleInput.oninput = () => { wheel.rumble = rumbleInput.value; wheel.sendLocalState(); };
  const forceInput = document.getElementById('force');
  forceInput.oninput = (e) => { wheel.force = forceInput.value; wheel.sendLocalState(); };
});

////////////////////////////////// Init SVGs 

window.onload =  () => setupSVG();

function setupSVG() {
  const inputsEl = document.getElementById('inputs');
  wheelEl = document.getElementById('wheel');  
  wheelNameEl = document.getElementById('wheelName');  
  debugEl = document.getElementById('debug');
  buttonShapes = Array.from(inputsEl.getElementById('buttons').children);
  axisShapes = Array.from(inputsEl.getElementById('axes').children);
}