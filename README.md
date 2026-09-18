## vimmotions for word in the browser

This uses the package ydotool and a local python script to synthesize keypresses at the OS level which the browser does not flag as untrusted. This is required to avoid the hell of manipulating the browser word DOM.

### Implemented

- Movement with h,j,k,l,w,b
- Switch modes with i,a,ESC

### Firefox Instructions

1. clone repository
2. open firefox
3. go to about:debugging#/runtime/this-firefox
4. Load temporary add on and choose the manifest.json file

create python file to communicate with package that can synthesize key events, depending on OS
