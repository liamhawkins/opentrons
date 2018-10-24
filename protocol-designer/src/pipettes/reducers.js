// @flow
import {combineReducers} from 'redux'
import {handleActions} from 'redux-actions'
import mapValues from 'lodash/mapValues'
import reduce from 'lodash/reduce'

import type {LoadFileAction, NewProtocolFields} from '../load-file'
import type {PipetteData} from '../step-generation'
import type {FilePipette} from '../file-types'
import {createPipette, createNewPipettesSlice} from './utils'
import type {PipetteReducerState, UpdatePipettesAction} from './types'

// TODO: BC 2018-10-24 remove pipettes.pipettes and hang byId and byMount
// directly off of root.pipettes branch of redux store
const pipettes = handleActions({
  LOAD_FILE: (state: PipetteReducerState, action: LoadFileAction): PipetteReducerState => {
    const file = action.payload
    const {pipettes} = file
    // TODO: Ian 2018-06-29 create fns to access ProtocolFile data
    const {pipetteTiprackAssignments} = file['designer-application'].data
    const pipetteIds = Object.keys(pipettes)
    return {
      byMount: {
        left: pipetteIds.find(id => pipettes[id].mount === 'left'),
        right: pipetteIds.find(id => pipettes[id].mount === 'right'),
      },
      byId: reduce(
        pipettes,
        (acc: {[pipetteId: string]: PipetteData}, p: FilePipette, id: string) => {
          const newPipette = createPipette(p.mount, p.model, pipetteTiprackAssignments[id], id)
          return newPipette
            ? {...acc, [id]: newPipette}
            : acc
        }, {}),
    }
  },
  CREATE_NEW_PROTOCOL: (state: PipetteReducerState, action: {payload: NewProtocolFields}): PipetteReducerState => (
    createNewPipettesSlice(state, action.payload.left, action.payload.right)
  ),
  UPDATE_PIPETTES: (state: PipetteReducerState, action: UpdatePipettesAction) => action.payload,
  SWAP_PIPETTES: (
    state: PipetteReducerState,
    action: {payload: NewProtocolFields}
  ): PipetteReducerState => {
    const byId = mapValues(state.byId, (pipette: PipetteData): PipetteData => ({
      ...pipette,
      mount: (pipette.mount === 'left') ? 'right' : 'left',
    }))

    return ({
      byMount: {left: state.byMount.right, right: state.byMount.left},
      byId,
    })
  },
}, {byMount: {left: null, right: null}, byId: {}})

const _allReducers = {pipettes}

export type RootState = {
  pipettes: PipetteReducerState,
}

export const rootReducer = combineReducers(_allReducers)
