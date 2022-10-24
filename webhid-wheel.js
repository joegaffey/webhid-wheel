/////////////////////// Inspired by https://github.com/TheBITLINK/WebHID-DS4

export class Wheel {

  constructor () {    
    if (!navigator.hid || !navigator.hid.requestDevice) {
      throw new Error('WebHID not supported by browser or not available.')
    }
  }

  /**
   * Initializes the WebHID API and requests access to the wheelbase.
   * 
   * This function must be called in the context of user interaction
   * (i.e in a click event handler), otherwise it might not work.
   */
  async init () {
    
    if (this.device && this.device.opened) 
      return;

    const devices = await navigator.hid.requestDevice({
      // TODO: Add a list of supported wheels
      filters: []
    });

    this.device = devices[0];
    try { 
      await this.device.open(); 
    } 
    catch(e) { 
      console.log('Device not connected'); 
      return; 
    };
    
    console.log('Device connected');
    this.name = this.device.productName;
    this.device.oninputreport = (report) => this.processWheelReport(report)
  }
  
  processWheelReport(report) {
    // console.log(report)
    const { data } = report;
    this.lastReport = data.buffer;
    this.timestamp = report.timeStamp;
    this.updateState(data);
  }

  /**
   * Updates the virtual wheel state
   * @param data - data from the HID report.
   */
  updateState(data) {
    this.debug = new Uint8Array(data.buffer);

    const buttonsData = data.getUint8(1);
    this.buttons = new Array(16).fill(false);
    const offset = data.getUint8(0)
    this.setRotation(offset, buttonsData % 4);
    
    const buttonsNum = buttonsData - buttonsData % 4;
    if(buttonsNum === 4) { this.buttons[0] = true;  }  
    if(buttonsNum === 8) { this.buttons[1] = true; }  
    if(buttonsNum === 16) { this.buttons[2] = true; }  
    if(buttonsNum === 32) { this.buttons[3] = true; }
    if(buttonsNum === 64) { this.buttons[4] = true; }
    if(buttonsNum === 128) { this.buttons[5] = true; }
    
    const buttonsData1 = data.getUint8(2);
    if(buttonsData1 === 196) { this.buttons[6] = true; }  
    if(buttonsData1 === 200) { this.buttons[7] = true; }  
    if(buttonsData1 === 193) { this.buttons[8] = true; }  
    if(buttonsData1 === 194) { this.buttons[9] = true; }  
    if(buttonsData1 === 208) { this.buttons[10] = true; }  
    if(buttonsData1 === 224) { this.buttons[11] = true; }
    
    const buttonsData2 = data.getUint8(4);
    if(buttonsData2 === 160) { this.buttons[12] = true; }  
    if(buttonsData2 === 162) { this.buttons[13] = true; }  
    if(buttonsData2 === 164) { this.buttons[14] = true; }  
    if(buttonsData2 === 166) { this.buttons[15] = true; }    
    
    this.axes = new Array(5).fill(0);
    this.axes[0] = 255 - data.getUint8(5);
    this.axes[1] = 255 - data.getUint8(6);
  }
  
  setRotation(offset, quadrant) {
    this.rotation = (offset / 255 * 90) + 90 * quadrant;
  }

  /**
   * Sends the ffb command to the wheel - TBD.
   */
  async sendLocalState () {
    if (!this.device) 
      throw new Error('Controller not initialized. You must call .init() first!')

    //Dummy data - TBD
    const reportId = 0x05;
    const data = Uint8Array.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);

    return this.device.sendReport(reportId, data);
  }
}  

window.onerror = function(message, source, lineno, colno, error) {
  console.log('onerror handler logging error', message);
  return true;
}
window.onunhandledrejection = function(message, source, lineno, colno, error) {
  console.log('onunhandledrejection handler logging error', message);
  return true;
}

