// @flow
import {combineReducers} from 'redux'
import {handleActions, type ActionType} from 'redux-actions'
import {createSelector} from 'reselect'

import forEach from 'lodash/forEach'
import omit from 'lodash/omit'
import mapValues from 'lodash/mapValues'
import max from 'lodash/max'
import pickBy from 'lodash/pickBy'
import reduce from 'lodash/reduce'
import isEmpty from 'lodash/isEmpty'

import {sortedSlotnames, FIXED_TRASH_ID} from '../../constants.js'
import {uuid} from '../../utils'
import {labwareToDisplayName} from '../utils'

import type {DeckSlot} from '@opentrons/components'
import {getIsTiprack} from '@opentrons/shared-data'

import type {SingleLabwareLiquidState, LabwareLiquidState} from '../../step-generation'

import type {
  IngredInputs,
  LiquidGroupsById,
  AllIngredGroupFields,
  LiquidGroup,
  OrderedLiquids,
  Labware,
  LabwareTypeById,
} from '../types'
import * as actions from '../actions'
import {getPDMetadata} from '../../file-types'
import type {BaseState, Selector, Options} from '../../types'
import type {LoadFileAction} from '../../load-file'
import type {
  RemoveWellsContents,
  DeleteLiquidGroup,
  EditLiquidGroupAction,
  MoveLabware,
  SelectLiquidAction,
  SetWellContentsAction,
} from '../actions'

// external actions (for types)
import typeof {openWellSelectionModal} from '../../well-selection/actions'

// UTILS
const nextEmptySlot = loadedContainersSubstate => {
  // Next empty slot in the sorted slotnames order. Or null if no more slots.
  const nextEmptySlotIdx = sortedSlotnames.findIndex(slot => !(slot in loadedContainersSubstate))
  const result = nextEmptySlotIdx >= sortedSlotnames.length ? null : sortedSlotnames[nextEmptySlotIdx]
  return result
}

// REDUCERS

// modeLabwareSelection: boolean. If true, we're selecting labware to add to a slot
// (this state just toggles a modal)
const modeLabwareSelection = handleActions({
  OPEN_ADD_LABWARE_MODAL: (state, action: ActionType<typeof actions.openAddLabwareModal>) =>
      action.payload.slot,
  CLOSE_LABWARE_SELECTOR: () => false,
  CREATE_CONTAINER: () => false,
}, false)

// If falsey, we aren't moving labware. Else, value should be the containerID we're
// ready to move.
const moveLabwareMode = handleActions({
  SET_MOVE_LABWARE_MODE: (state, action: ActionType<typeof actions.setMoveLabwareMode>) => action.payload,
  MOVE_LABWARE: (state, action: MoveLabware) => false, // leave move mode after performing a move action
}, false)

type SelectedContainerId = string | null
const selectedContainerId = handleActions({
  OPEN_INGREDIENT_SELECTOR: (state, action: ActionType<typeof actions.openIngredientSelector>): SelectedContainerId => action.payload,
  CLOSE_INGREDIENT_SELECTOR: (state, action: ActionType<typeof actions.closeIngredientSelector>): SelectedContainerId => null,

  // $FlowFixMe: Cannot get `action.payload` because property `payload` is missing in function
  OPEN_WELL_SELECTION_MODAL: (state, action: ActionType<openWellSelectionModal>): SelectedContainerId =>
   action.payload.labwareId,
  CLOSE_WELL_SELECTION_MODAL: (): SelectedContainerId => null,
}, null)

type RenameLabwareFormModeState = boolean
const renameLabwareFormMode = handleActions({
  OPEN_RENAME_LABWARE_FORM: () => true,
  CLOSE_RENAME_LABWARE_FORM: () => false,
  CLOSE_INGREDIENT_SELECTOR: () => false,
}, false)

type DrillDownLabwareId = string | null
const drillDownLabwareId = handleActions({
  DRILL_DOWN_ON_LABWARE: (state, action: ActionType<typeof actions.drillDownOnLabware>): DrillDownLabwareId => action.payload,
  DRILL_UP_FROM_LABWARE: (state, action: ActionType<typeof actions.drillUpFromLabware>): DrillDownLabwareId => null,
}, null)

type ContainersState = {
  [id: string]: ?Labware,
}

export type SelectedLiquidGroupState = {liquidGroupId: ?string, newLiquidGroup?: true}
const unselectedLiquidGroupState = {liquidGroupId: null}
// This is only a concern of the liquid page.
// null = nothing selected, newLiquidGroup: true means user is creating new liquid
const selectedLiquidGroup = handleActions({
  SELECT_LIQUID_GROUP: (state: SelectedLiquidGroupState, action: SelectLiquidAction): SelectedLiquidGroupState =>
    ({liquidGroupId: action.payload}),
  DELETE_LIQUID_GROUP: () => unselectedLiquidGroupState,
  DESELECT_LIQUID_GROUP: () => unselectedLiquidGroupState,
  CREATE_NEW_LIQUID_GROUP_FORM: (): SelectedLiquidGroupState =>
    ({liquidGroupId: null, newLiquidGroup: true}),
  NAVIGATE_TO_PAGE: () => unselectedLiquidGroupState, // clear selection on navigate
  EDIT_LIQUID_GROUP: () => unselectedLiquidGroupState, // clear on form save
}, unselectedLiquidGroupState)

const initialLabwareState: ContainersState = {
  [FIXED_TRASH_ID]: {
    id: FIXED_TRASH_ID,
    type: 'fixed-trash',
    disambiguationNumber: 1,
    name: 'Trash',
    slot: '12',
  },
}

function getNextDisambiguationNumber (allLabwareById: ContainersState, labwareType: string): number {
  const allIds = Object.keys(allLabwareById)
  const sameTypeLabware = allIds.filter(labwareId =>
    allLabwareById[labwareId] &&
    allLabwareById[labwareId].type === labwareType)
  const disambigNumbers = sameTypeLabware.map(labwareId =>
    (allLabwareById[labwareId] &&
    allLabwareById[labwareId].disambiguationNumber) || 0)

  return disambigNumbers.length > 0
    ? Math.max(...disambigNumbers) + 1
    : 1
}

export const containers = handleActions({
  CREATE_CONTAINER: (state: ContainersState, action: ActionType<typeof actions.createContainer>) => {
    const id = uuid() + ':' + action.payload.containerType
    return {
      ...state,
      [id]: {
        slot: action.payload.slot || nextEmptySlot(_loadedContainersBySlot(state)),
        type: action.payload.containerType,
        disambiguationNumber: getNextDisambiguationNumber(state, action.payload.containerType),
        id,
        name: null, // create with null name, so we force explicit naming.
      },
    }
  },
  DELETE_CONTAINER: (state: ContainersState, action: ActionType<typeof actions.deleteContainer>) => pickBy(
    state,
    (value: Labware, key: string) => key !== action.payload.containerId
  ),
  MODIFY_CONTAINER: (state: ContainersState, action: ActionType<typeof actions.modifyContainer>) => {
    const { containerId, modify } = action.payload
    return {...state, [containerId]: {...state[containerId], ...modify}}
  },
  MOVE_LABWARE: (state: ContainersState, action: MoveLabware): ContainersState => {
    const { toSlot, fromSlot } = action.payload
    const fromContainers = reduce(state, (acc, container, id) => (
      container.slot === fromSlot ? {...acc, [id]: {...container, slot: toSlot}} : acc
    ), {})
    const toContainers = reduce(state, (acc, container, id) => (
      container.slot === toSlot ? {...acc, [id]: {...container, slot: fromSlot}} : acc
    ), {})
    return {
      ...state,
      ...fromContainers,
      ...toContainers,
    }
  },
  LOAD_FILE: (state: ContainersState, action: LoadFileAction): ContainersState => {
    const file = action.payload
    const allFileLabware = file.labware
    const labwareIds: Array<string> = Object.keys(allFileLabware).sort((a, b) =>
      Number(allFileLabware[a].slot) - Number(allFileLabware[b].slot))

    return labwareIds.reduce((acc: ContainersState, id): ContainersState => {
      const fileLabware = allFileLabware[id]
      return {
        ...acc,
        [id]: {
          slot: fileLabware.slot,
          id,
          type: fileLabware.model,
          name: fileLabware['display-name'],
          disambiguationNumber: getNextDisambiguationNumber(acc, fileLabware.model),
        },
      }
    }, {})
  },
}, initialLabwareState)

type SavedLabwareState = {[labwareId: string]: boolean}
/** Keeps track of which labware have saved nicknames */
export const savedLabware = handleActions({
  DELETE_CONTAINER: (state: SavedLabwareState, action: ActionType<typeof actions.deleteContainer>) => ({
    ...state,
    [action.payload.containerId]: false,
  }),
  MODIFY_CONTAINER: (state: SavedLabwareState, action: ActionType<typeof actions.modifyContainer>) => ({
    ...state,
    [action.payload.containerId]: true,
  }),
  LOAD_FILE: (state: SavedLabwareState, action: LoadFileAction): SavedLabwareState => (
    mapValues(action.payload.labware, () => true)
  ),
}, {})

type IngredientsState = LiquidGroupsById
export const ingredients = handleActions({
  EDIT_LIQUID_GROUP: (state: IngredientsState, action: EditLiquidGroupAction): IngredientsState => {
    const {liquidGroupId} = action.payload
    return {
      ...state,
      [liquidGroupId]: {...state[liquidGroupId], ...action.payload},
    }
  },
  DELETE_LIQUID_GROUP: (state: IngredientsState, action: DeleteLiquidGroup): IngredientsState => {
    const liquidGroupId = action.payload
    return omit(state, liquidGroupId)
  },
  LOAD_FILE: (state: IngredientsState, action: LoadFileAction): IngredientsState =>
    getPDMetadata(action.payload).ingredients,
}, {})

type LocationsState = LabwareLiquidState

export const ingredLocations = handleActions({
  SET_WELL_CONTENTS: (state: LocationsState, action: SetWellContentsAction): LocationsState => {
    const {liquidGroupId, labwareId, wells, volume} = action.payload
    const newWellContents = {[liquidGroupId]: {volume}}
    const updatedWells = wells.reduce((acc, wellName): SingleLabwareLiquidState => ({
      ...acc,
      [wellName]: newWellContents,
    }), {})

    return {
      ...state,
      [labwareId]: {
        ...state[labwareId],
        ...updatedWells,
      },
    }
  },
  REMOVE_WELLS_CONTENTS: (state: LocationsState, action: RemoveWellsContents): LocationsState => {
    const {wells, labwareId} = action.payload
    return {
      ...state,
      [labwareId]: {
        ...omit(state[labwareId], wells),
      },
    }
  },
  DELETE_LIQUID_GROUP: (state: LocationsState, action: DeleteLiquidGroup): LocationsState => {
    const liquidGroupId = action.payload
    return mapValues(state, labwareContents =>
      mapValues(labwareContents, well =>
        omit(well, liquidGroupId)))
  },
  LOAD_FILE: (state: LocationsState, action: LoadFileAction): LocationsState =>
    getPDMetadata(action.payload).ingredLocations,
}, {})

export type RootState = {|
  modeLabwareSelection: ?DeckSlot,
  moveLabwareMode: ?DeckSlot,
  selectedContainerId: SelectedContainerId,
  drillDownLabwareId: DrillDownLabwareId,
  containers: ContainersState,
  savedLabware: SavedLabwareState,
  selectedLiquidGroup: SelectedLiquidGroupState,
  ingredients: IngredientsState,
  ingredLocations: LocationsState,
  renameLabwareFormMode: RenameLabwareFormModeState,
|}

// TODO Ian 2018-01-15 factor into separate files
const rootReducer = combineReducers({
  modeLabwareSelection,
  moveLabwareMode,
  selectedContainerId,
  selectedLiquidGroup,
  drillDownLabwareId,
  containers,
  savedLabware,
  ingredients,
  ingredLocations,
  renameLabwareFormMode,
})

// SELECTORS
const rootSelector = (state: BaseState): RootState => state.labwareIngred

const getLabware: Selector<{[labwareId: string]: ?Labware}> = createSelector(
  rootSelector,
  rootState => rootState.containers
)

const getLabwareNames: Selector<{[labwareId: string]: string}> = createSelector(
  getLabware,
  (_labware) => mapValues(
    _labware,
    labwareToDisplayName,
  )
)

const getLabwareTypes: Selector<LabwareTypeById> = createSelector(
  getLabware,
  (_labware) => mapValues(
    _labware,
    (l: Labware) => l.type
  )
)

const getLiquidGroupsById = (state: BaseState) => rootSelector(state).ingredients
const getIngredientLocations = (state: BaseState) => rootSelector(state).ingredLocations

const getNextLiquidGroupId: Selector<string> = createSelector(
  getLiquidGroupsById,
  (_ingredGroups) => ((max(Object.keys(_ingredGroups).map(id => parseInt(id))) + 1) || 0).toString()
)

const getLiquidNamesById: Selector<{[ingredId: string]: string}> = createSelector(
  getLiquidGroupsById,
  ingredGroups => mapValues(ingredGroups, (ingred: LiquidGroup) => ingred.name)
)

const getLiquidSelectionOptions: Selector<Options> = createSelector(
  getLiquidGroupsById,
  (liquidGroupsById) => {
    return Object.keys(liquidGroupsById).map(id => ({
      // NOTE: if these fallbacks are used, it's a bug
      name: (liquidGroupsById[id])
        ? liquidGroupsById[id].name || `(Unnamed Liquid: ${String(id)})`
        : 'Missing Liquid',
      value: id,
    }))
  }
)

const _loadedContainersBySlot = (containers: ContainersState) =>
  reduce(containers, (acc, labware: ?Labware) => (labware && labware.slot)
    ? {...acc, [labware.slot]: labware.type}
    : acc
  , {})

const loadedContainersBySlot = createSelector(
  getLabware,
  containers => _loadedContainersBySlot(containers)
)

/** Returns options for dropdowns, excluding tiprack labware */
const labwareOptions: Selector<Options> = createSelector(
  getLabware,
  getLabwareNames,
  (_labware, names) => reduce(_labware, (acc: Options, labware: Labware, labwareId): Options => {
    const isTiprack = getIsTiprack(labware.type)
    if (!labware.type || isTiprack) {
      return acc
    }
    return [
      ...acc,
      {
        name: names[labwareId],
        value: labwareId,
      },
    ]
  }, [])
)

const DISPOSAL_LABWARE_TYPES = ['trash-box', 'fixed-trash']
/** Returns options for disposal (e.g. fixed trash and trash box) */
const disposalLabwareOptions: Selector<Options> = createSelector(
  getLabware,
  getLabwareNames,
  (_labware, names) => reduce(_labware, (acc: Options, labware: Labware, labwareId): Options => {
    if (!labware.type || !DISPOSAL_LABWARE_TYPES.includes(labware.type)) {
      return acc
    }
    return [
      ...acc,
      {
        name: names[labwareId],
        value: labwareId,
      },
    ]
  }, [])
)

// false or selected slot to add labware to, eg 'A2'
const selectedAddLabwareSlot = (state: BaseState) => rootSelector(state).modeLabwareSelection

const getSavedLabware = (state: BaseState) => rootSelector(state).savedLabware

const getSelectedContainerId: Selector<SelectedContainerId> = createSelector(
  rootSelector,
  rootState => rootState.selectedContainerId
)

const getSelectedLiquidGroupState: Selector<SelectedLiquidGroupState> = createSelector(
  rootSelector,
  rootState => rootState.selectedLiquidGroup
)

const getSelectedContainer: Selector<?Labware> = createSelector(
  getSelectedContainerId,
  getLabware,
  (_selectedId, _labware) => (_selectedId && _labware[_selectedId]) || null
)

const getDrillDownLabwareId: Selector<DrillDownLabwareId> = createSelector(
  rootSelector,
  rootState => rootState.drillDownLabwareId
)

type ContainersBySlot = { [DeckSlot]: {...Labware, containerId: string} }

const containersBySlot: Selector<ContainersBySlot> = createSelector(
  getLabware,
  containers => reduce(
    containers,
    (acc: ContainersBySlot, containerObj: Labware, containerId: string) => ({
      ...acc,
      // NOTE: containerId added in so you still have a reference
      [containerObj.slot]: {...containerObj, containerId},
    }),
    {})
)

// TODO Ian 2018-07-06 consolidate into types.js
type IngredGroupFields = {
  [ingredGroupId: string]: {
    groupId: string,
    ...$Exact<IngredInputs>,
  },
}
const allIngredientGroupFields: Selector<AllIngredGroupFields> = createSelector(
  getLiquidGroupsById,
  (ingreds) => reduce(
    ingreds,
    (acc: IngredGroupFields, ingredGroup: IngredGroupFields, ingredGroupId: string) => ({
      ...acc,
      [ingredGroupId]: ingredGroup,
    }), {})
)

const allIngredientNamesIds: BaseState => OrderedLiquids = createSelector(
  getLiquidGroupsById,
  ingreds => Object.keys(ingreds).map(ingredId =>
      ({ingredientId: ingredId, name: ingreds[ingredId].name}))
)

// TODO: just use the individual selectors separately, no need to combine it into 'activeModals'
// -- so you'd have to refactor the props of the containers that use this selector too
type ActiveModals = {
  labwareSelection: boolean,
  ingredientSelection: ?{
    slot: ?DeckSlot,
    containerName: ?string,
  },
}

const activeModals: Selector<ActiveModals> = createSelector(
  rootSelector,
  getLabware,
  getSelectedContainerId,
  (state, _allLabware, _selectedContainerId) => {
    const selectedContainer = _selectedContainerId && _allLabware[_selectedContainerId]
    return ({
      labwareSelection: state.modeLabwareSelection !== false,
      ingredientSelection: {
        slot: selectedContainer ? selectedContainer.slot : null,
        containerName: selectedContainer && selectedContainer.type,
      },
    })
  }
)

const getRenameLabwareFormMode = (state: BaseState) => rootSelector(state).renameLabwareFormMode

const slotToMoveFrom = (state: BaseState) => rootSelector(state).moveLabwareMode

const hasLiquid = (state: BaseState) => !isEmpty(getLiquidGroupsById(state))

const getLiquidGroupsOnDeck: Selector<Array<string>> = createSelector(
  getIngredientLocations,
  (ingredLocationsByLabware) => {
    let liquidGroups: Set<string> = new Set()
    forEach(ingredLocationsByLabware, (byWell: $Values<typeof ingredLocationsByLabware>) =>
      forEach(byWell, (groupContents: $Values<typeof byWell>) => {
        forEach(groupContents, (contents: $Values<typeof groupContents>, groupId: $Keys<typeof groupContents>) => {
          if (contents.volume > 0) {
            liquidGroups.add(groupId)
          }
        })
      })
    )
    return [...liquidGroups]
  }
)

// TODO: prune selectors
export const selectors = {
  rootSelector,

  getLiquidGroupsById,
  getIngredientLocations,
  getLiquidNamesById,
  getLabware,
  getLabwareNames,
  getLabwareTypes,
  getLiquidSelectionOptions,
  getLiquidGroupsOnDeck,
  getNextLiquidGroupId,
  getSavedLabware,
  getSelectedContainer,
  getSelectedContainerId,
  getSelectedLiquidGroupState,
  getDrillDownLabwareId,

  activeModals,
  getRenameLabwareFormMode,

  slotToMoveFrom,

  allIngredientGroupFields,
  allIngredientNamesIds,
  loadedContainersBySlot,
  containersBySlot,
  selectedAddLabwareSlot,
  disposalLabwareOptions,
  labwareOptions,
  hasLiquid,
}

export default rootReducer
