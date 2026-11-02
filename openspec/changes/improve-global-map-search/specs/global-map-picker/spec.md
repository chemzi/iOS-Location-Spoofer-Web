## Purpose

让个人自建定位面板能够在国外查看可辨认的街道或卫星底图，使用全球地名搜索定位目标，并在不同图层与搜索来源之间保持同一套真实地理坐标。搜索、预览和图层操作不得意外改变已经锁定的服务器位置。

## ADDED Requirements

### Requirement: Global street map and remembered layer choice

The picker SHALL initially select a working global street basemap when no valid layer preference exists, regardless of the Amap key. It SHALL retain domestic street, domestic satellite, and global satellite choices and remember explicit layer selection across reloads. Attribution SHALL remain visible and tile loading SHALL follow provider caching and usage policies.

#### Scenario: First overseas visit
- **WHEN** a user without a saved layer preference opens the picker at Tokyo or New York
- **THEN** the default map SHALL display identifiable geographic detail rather than a blank or API-key-required image without requiring a new account or key

#### Scenario: Remembered choice
- **WHEN** a user explicitly selects a supported layer and reloads the page
- **THEN** the selected layer SHALL be restored, preserving its coordinate system conversion

### Requirement: Independent geographic search scope

The picker SHALL offer explicit global and domestic search scopes with global as the default and SHALL display the active scope. Global search SHALL remain available with an Amap key configured and SHALL NOT change merely because a basemap changes. Users SHALL trigger upstream searches only through an explicit search action.

#### Scenario: Global search while Amap is configured
- **WHEN** a user searches for `Shibuya Tokyo` or `New York` in global scope
- **THEN** the picker SHALL show matching international results with country and locality information even when the domestic layer or Amap configuration exists

#### Scenario: Domestic search
- **WHEN** a user explicitly selects domestic search
- **THEN** the picker SHALL use the existing domestic provider, or show a clear unavailable-provider message if its key is missing

### Requirement: Common Chinese overseas aliases

Global search SHALL resolve the declared aliases `东京`, `东京涩谷`, `涩谷`, and `纽约` to the corresponding overseas queries before geocoding. Results SHALL disclose country/locality so similarly named domestic POIs can be distinguished. Unknown Chinese aliases SHALL NOT be silently assigned to an overseas location.

#### Scenario: Chinese query for Shibuya
- **WHEN** a user submits `东京涩谷` or `涩谷` in global scope
- **THEN** the search SHALL query the declared Shibuya/Tokyo equivalent and show Japan in the corresponding results

#### Scenario: Chinese query for New York
- **WHEN** a user submits `纽约` in global scope
- **THEN** the search SHALL query the declared New York equivalent and allow selection of New York, United States

### Requirement: Same-origin bounded search service

Search SHALL pass through a same-origin endpoint protected by the existing application authentication. Responses SHALL use a consistent result shape with WGS-84 latitude/longitude, display name, country/locality, and provider. Upstream failure, throttling, and empty results SHALL be distinguishable. Requests SHALL be bounded, cached where appropriate, and SHALL NOT include the application token in third-party requests.

#### Scenario: Unauthorized caller
- **WHEN** a search request lacks the credentials required by the current application
- **THEN** it SHALL be rejected before invoking an upstream provider

#### Scenario: Slow or unavailable provider
- **WHEN** an upstream request times out or returns an error
- **THEN** the picker SHALL exit its loading state with an actionable error and SHALL NOT overwrite a newer query's results or change the locked location

### Requirement: Geographic identity and explicit persistence

Search-result jumps, layer changes, direct coordinate entry, and favorite jumps SHALL preserve the intended WGS-84 location. Longitudes saved through the existing interface SHALL remain in [-180,180). Only the existing explicit lock action SHALL save the active target; the `/set`, `/loc.json`, favorites, and Shadowrocket contracts SHALL remain compatible.

#### Scenario: Search and switch layers
- **WHEN** a user selects a global result and switches among street, global satellite, and domestic layers
- **THEN** the geographic target SHALL remain unchanged to within 1e-5 degrees for overseas points and 2e-5 degrees for domestic conversion round trips, and no save SHALL occur

#### Scenario: Lock an overseas point
- **WHEN** a user explicitly locks a New York point after previewing it
- **THEN** `/loc.json` SHALL return its selected WGS-84 coordinates with a negative western longitude and the existing metadata fields

### Requirement: Recoverable map and search presentation

Tile-load failures SHALL present a non-blocking status and an available layer-switch action instead of leaving users without an explanation. A successful load SHALL clear the error. Search results SHALL show country/locality and provider, and empty global queries SHALL offer a local-script/English query hint and direct-coordinate entry.

#### Scenario: Tile service failure
- **WHEN** the active tile layer reports a sustained loading failure
- **THEN** the page SHALL offer switching layers without resetting the target or saving a location

#### Scenario: Empty global result
- **WHEN** a global search has no results
- **THEN** the page SHALL distinguish no matches from a network error and suggest a more specific local-script or English name, or coordinates
