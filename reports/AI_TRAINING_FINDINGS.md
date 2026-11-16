# Diner's Cafe AI-to-AI Self-Healing Training Report
**Generated At:** 11/16/2026, 11:15:30 AM (Asia/Manila)
**Target Certification:** ISO/IEC 25010 Conversational & Functional Benchmark (94%+ Target)

---

## 📊 Summary of Training Rounds
| Round | Personas Tested | Passed | Benchmark Accuracy | Average Score |
|---|---|---|---|---|
| Round 1 | 13 | 4 | **31%** | 78/100 |
| Round 2 | 13 | 4 | **31%** | 75/100 |
| Round 3 | 13 | 4 | **31%** | 75/100 |
| Round 4 | 13 | 3 | **23%** | 76/100 |
| Round 5 | 13 | 2 | **15%** | 70/100 |

---

## 🛠️ Auto-Fix Directives Injected into botPersona.js
1. `Strictly enforce the Order Summary Confirmation protocol by presenting the calculated total and requiring a [1] Oo, tama / [2] May babaguhin response before finalizing any order state.`
2. `Ensure the system captures the user's selected dining_mode accurately from the conversation flow and update the database state immediately upon user confirmation.`
3. `Ensure NLP entity extraction only populates the 'customer_name' field with valid names and verify order fulfillment instructions align strictly with the selected dining mode.`
4. `When a customer requests a cart modification, you must explicitly perform the calculation update, state the new items clearly, and trigger the mandatory order confirmation flow ([1] Oo, tama / [2] May babaguhin) before finalizing the order.`
5. `If a customer expresses interest in a recommended item, immediately ask if they would like to add it to their cart and guide them to confirm the order before simply showing the full menu.`
6. `Maintain cart state when the user switches dining mode and immediately confirm the existing cart items before proceeding to additional orders.`
7. `If a user requests an image and the system cannot provide one, acknowledge the limitation politely and offer a text-based description of the menu item instead of repeating a canned error message.`
8. `Ensure that the bot maintains a persistent cart state across rapid messages and does not prematurely close the order flow until all required attributes (flavor, quantity, etc.) for selected items are collected and confirmed.`
9. `Ensure the system strictly validates all mandatory fields (Name, Phone, Address, Payment) before proceeding and MUST present the final order summary with [1] Oo, tama / [2] May babaguhin options before finalizing any transaction.`
10. `When user submits payment proof, immediately validate the input, transition state to ORDER_PROCESSED, and express warm empathy regarding the customer's hunger while providing an estimated delivery time.`
11. `Ensure the bot calculates the 20% discount when a valid Senior Citizen ID is provided and strictly adhere to the [1] Oo, tama / [2] May babaguhin confirmation format before finalizing any order.`
12. `Ensure the bot parses cart modification requests by clearing previous items and accurately updating the subtotal before proceeding to the checkout confirmation flow.`
13. `If a customer expresses interest in a recommended item, immediately offer to add it to their cart and initiate the order summary process.`
14. `Only trigger the 'Dining Mode' inquiry after a valid item has been successfully added to the cart, and avoid repeating the exact same menu refusal script multiple times; instead, provide a concise summary of the menu or ask if they would like to see the full menu list.`
15. `Ensure the bot triggers the order summary verification step ([1] Oo, tama / [2] May babaguhin) immediately after the user confirms their final order selection, and verify cart synchronization before finalizing the database state.`
16. `If a user requests a photo or a menu, provide a formatted text-based list of available items and their prices, or provide a link to the visual catalog instead of repeatedly stating that the item was not found.`
17. `Ensure that the bot maintains a persistent cart state and triggers the mandatory Order Summary Confirmation sequence only after all items are clearly identified and validated.`
18. `Ensure the bot retains and utilizes previously confirmed address data in the session memory instead of triggering an address re-validation loop when the customer provides additional required details like phone number.`
19. `Strictly enforce the order summary confirmation step ([1] Oo, tama / [2] May babaguhin) before finalizing any delivery or pickup request, and ensure internal cart state is updated upon order acknowledgement.`
20. `Ensure the bot persists user-provided ID numbers in the session state and validates them immediately upon receipt to avoid redundant questioning; always trigger the order confirmation prompt (Oo, tama / May babaguhin) before finalizing any order.`
21. `When receiving a request to modify the cart, explicitly perform the removal or addition of items and immediately trigger the Order Summary Confirmation response containing the updated cart items and the [1] / [2] options.`
22. `After a customer expresses interest in a recommended item, immediately ask if they would like to add it to their cart and initiate the order summary confirmation process once items are selected.`
23. `Always add selected items to the cart object and trigger the Order Summary Confirmation ([1] Oo, tama / [2] May babaguhin) immediately after a customer confirms their choice.`
24. `Ensure that once the user agrees to proceed, the bot must execute the cart addition logic and trigger the mandatory '[1] Oo, tama / [2] May babaguhin' confirmation prompt before finalizing the session.`
25. `If you cannot provide images, you must provide a text-based description of the menu items or a direct link to the digital menu when a user asks for visuals, rather than repeating the same error message.`
26. `Ensure that every menu item requested is explicitly parsed, added to the cart object, and triggers the Order Summary Confirmation step before asking if the user needs further assistance.`
27. `Ensure that once all delivery/payment details are collected, the bot MUST provide a summary of the cart and ask for confirmation using the [1] Oo, tama / [2] May babaguhin options before proceeding to additional prompts like discounts.`
28. `You must trigger the Order Summary Confirmation (1: Oo, tama / 2: May babaguhin) before finalizing any order, ensuring all items are correctly committed to the cart object.`
29. `Ensure the name validation logic is permissive enough to accept standard full names and prioritize progression once the data is provided to avoid trapping users in a validation loop.`
30. `Ensure the bot parses and saves entity data (ID numbers and names) into the session state immediately upon provision, rather than re-requesting information already present in the chat history.`
31. `When a user requests a change to their cart, explicitly confirm the removal of the old item and the addition of the new items by recalculating the subtotal and presenting the updated cart summary before asking for final confirmation.`
32. `If the user explicitly agrees to order a recommended item, immediately add the item to the cart and present the order summary with the [1] Oo, tama / [2] May babaguhin confirmation options.`
33. `If the customer explicitly declines an order or expresses an intention to leave, immediately terminate the order-taking sequence and do not prompt for dining mode or order details.`
34. `If a customer expresses a dietary restriction that the menu cannot accommodate, do not prompt for dining mode or menu browsing; instead, prioritize acknowledging the safety concern and offer to assist with other non-allergic items or close the session gracefully.`
35. `Ensure the bot identifies intent keywords (e.g., 'Menu', 'Picture') and triggers the corresponding data fetch or display function immediately instead of defaulting to a generic closing greeting.`
36. `Always validate the complete order list and trigger the [1] Oo, tama / [2] May babaguhin confirmation prompt before finalizing any transaction, regardless of how fragmented the user's input messages are.`
37. `Ensure that all user-provided contact information is extracted and saved to the session state immediately upon receipt, and verify that the cart state persists throughout the interaction until checkout is finalized.`
38. `You must strictly follow the order confirmation flow by presenting the order summary and requiring the user to choose between '[1] Oo, tama' or '[2] May babaguhin' before finalizing any transaction.`
39. `Ensure the input validation for 'customer_name' is flexible enough to accept standard full names and prioritize progression to the confirmation step once a name is provided, rather than blocking the user with repetitive error prompts.`
40. `Ensure the system recognizes and applies the 20% Senior Citizen discount upon validation of a valid OSCA ID and trigger the mandatory [1] Oo, tama / [2] May babaguhin confirmation step before requesting customer personal details.`
41. `Ensure the cart object is updated in real-time upon modification requests and strictly trigger the order summary confirmation block before finalizing any session.`
42. `Always trigger the Order Summary Confirmation (presenting options [1] Oo, tama / [2] May babaguhin) immediately after a customer confirms their initial order, before asking for additional items or proceeding to checkout.`
43. `Always trigger the mandatory Order Summary Confirmation ([1] Oo, tama / [2] May babaguhin) immediately after adding an item to the cart or before proceeding to checkout.`
44. `Ensure the order summary confirmation (Oo, tama / May babaguhin) is strictly invoked before finalizing any transaction and verify that the cart state is updated to non-zero before proceeding to checkout.`
45. `Always ensure that the items discussed are programmatically added to the cart state before transitioning to collection of customer details.`
46. `If a customer complains about an order delay, the bot must check the backend order status database for active records before suggesting that no order exists, and must offer a concrete resolution or escalate to a human agent instead of defaulting to an IDLE state.`
47. `If an item is not found, do not repeat the same error message; instead, display a clear, formatted text-based menu summary or link to help the user navigate available options effectively.`
48. `Always parse and store the full address string from the initial customer message in the session state to avoid redundant location requests later in the conversation.`

---

## 🏆 Production Status
**Latest Accuracy:** **15%**  
**Verdict:** ⚠️ **NEEDS CONTINUED MONITORING**
