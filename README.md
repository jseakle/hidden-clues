<img width="1078" height="623" alt="image" src="https://github.com/user-attachments/assets/62bd2c9e-5f7e-4613-8266-4af738523576" />

This is a Chrome extension that hides each clue of a crossword puzzle on https://squares.io and https://downforacross.com. You can click to reveal each clue individually, and the percentage you've revealed so far is tracked.

I made this because it's quite fun to see how few you can use, and to think about strategies for revealing clues optimally. I try to aim for under 33% of clues revealed on a themed puzzle and under 50% on a themeless, though of course how viable this is will vary. I also count myself as having met this goal if there are a handful of isolated empty squares that could have one of several letters in them with no way to disambiguate except to reveal another clue.

This was made almost entirely with ChatGPT 5. I don't think LLMs are well suited for many purposes other than quickly making trivial bits of software like this, but it sure did nearly one-shot this task. However, it failed completely at linking the over-the-grid highligted clue box to the side panel clues, so I gave up on that eventually. I also spent way too long trying to use it to refine the button size and position, I should have just given up and done that part by hand.

Here are the lightly-edited prompts that produced the initial almost-entirely-working version:

> write a chrome extension that operates on https://squares.io puzzle pages, like <a squares link>. it hides each clue until a button is clicked. it also counts the total number of clues and displays this number on the screen, and subtracts one from it each time a clue is revealed.


> i'd like the clue counter to be draggable with the mouse. add a "reveal all" button to the floating clue counter, and change the text to say "Revealed: X/Y (Z%)" where X starts at 0 and is the number revealed so far and Y is the total and Z is the percentage currently revealed.


> make another version that also works on downforacross.com solve pages, like <a DFA link>
