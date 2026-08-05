# Architecture

> Scope: structure and design rationale for the Surrogate Modeling Toolkit
> For a guided walkthrough of the code, see CODEBASE_TOUR.md

## 1. What the system does
Reads user provided data and allows user to visualize, modify, and model the data.

## 2. Package map
One line summaries of the sub-folders in:
### app/

| Marker | Meaning |
|---|---|
| *built* | has working code that the running app uses.|
| *planned* | stub files only (`# TODO: implement`); the structure exists, the behavior does not.|
| *vestigial* | worked at one point, superseded by another package, never removed.|
| *partial* | portion is working code and part is stubs.|

- **api** - *built* sets up and handles the communication gates between frontend and backend
- **compliance** - *built* intended to guarantee no external calls - index.html currently violates this.
- **data** - *partial* sets up data in proper formatting/organization
- **learning** - *built* handles learning mode in app
- **middleware** - *planned.* Intended to intercept every request for logging.
- **ml** - *built* handles all machine learning models and implementation
- **report** - *built* collects STATE data and returns STATE summary data to render_template() to generate a report
- **routes** - *vestigial.* Only 'main.py' is live (serves the SPA shell). The five '*routes.py*' files are from a server-rendered design replaced by 'app/api/'.
- **security** - *planned* controls specification of security level of data input and output
- **state** - *partial* defines and handles app state

## 3. Entry points

## 4. Data flow

## 5. Open questions