## vimmotions for word in the browser

### Implemented

- Super basic movement with h,j,k,l,w,b
- Deleting with x (not working)
- Toggle insert and normal mode with i,a,esc
- replace caret in normal mode (kinda)

### Issues

- Moving between paragraphs is dodgy
- Can't maintain line offset when navigating between paragraphs
- Doesn't work for complicated segments, bullet points, tables etc.
- Doesn't interact well with manual scrolling and mouse movement

This is hell

### Firefox Instructions

1. clone repository
2. open firefox
3. go to about:debugging#/runtime/this-firefox
4. Load temporary add on and choose the manifest.json file
5. Click reload to update when changes are made
