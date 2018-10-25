// @flow
import uniq from 'lodash/uniq'
import {getWellSetForMultichannel} from '../../well-selection/utils'
import {selectors} from '../index'
import {selectors as pipetteSelectors} from '../../pipettes'
import {
  DEFAULT_MM_FROM_BOTTOM_ASPIRATE,
  DEFAULT_MM_FROM_BOTTOM_DISPENSE,
} from '../../constants'
import {selectors as labwareIngredSelectors} from '../../labware-ingred/reducers'
import type {PipetteChannels} from '@opentrons/shared-data'
import type {BaseState, GetState} from '../../types'

import type {ChangeFormPayload} from './types'

function _getAllWells (
  primaryWells: ?Array<string>,
  labwareType: ?string
): Array<string> {
  if (!labwareType || !primaryWells) {
    return []
  }

  const _labwareType = labwareType // TODO Ian 2018-05-04 remove this weird flow workaround

  const allWells = primaryWells.reduce((acc: Array<string>, well: string) => {
    const nextWellSet = getWellSetForMultichannel(_labwareType, well)
    // filter out any nulls (but you shouldn't get any)
    return (nextWellSet) ? [...acc, ...nextWellSet] : acc
  }, [])

  // remove duplicates (eg trough: [A1, A1, A1, A1, A1, A1, A1, A1] -> [A1])
  return uniq(allWells)
}

// TODO: Ian 2018-08-28 revisit this,
// maybe remove channels from pipette state and use shared-data?
// or if not, make this its own selector in pipettes/ atom
const getChannels = (pipetteId: string, state: BaseState): PipetteChannels => {
  const pipettes = pipetteSelectors.pipettesById(state)
  const pipette = pipettes[pipetteId]
  if (!pipette) {
    console.error(`${pipetteId} not found in pipettes, cannot handleFormChange properly`)
    return 1
  }
  return pipette.channels
}

// TODO: Ian 2018-09-20 this is only usable by 'unsavedForm'.
// Eventually we gotta allow arbitrary actions like DELETE_LABWARE
// (or more speculatively, CHANGE_PIPETTE etc), which affect saved forms from
// 'outside', to cause changes that run thru all the logic in this block
function handleFormChange (payload: ChangeFormPayload, getState: GetState): ChangeFormPayload {
  // Use state to handle form changes
  const baseState = getState()
  const unsavedForm = selectors.formData(baseState)
  let updateOverrides = {}

  if (unsavedForm == null) {
    // pass thru, unchanged
    return payload
  }

  // Changing labware clears wells selection: source labware
  if ('aspirate_labware' in payload.update) {
    updateOverrides = {
      ...updateOverrides,
      'aspirate_wells': null,
      'aspirate_mmFromBottom': DEFAULT_MM_FROM_BOTTOM_ASPIRATE,
    }
  }

  // Changing labware clears wells selection: dest labware
  if ('dispense_labware' in payload.update) {
    updateOverrides = {
      ...updateOverrides,
      'dispense_wells': null,
      'dispense_mmFromBottom': DEFAULT_MM_FROM_BOTTOM_DISPENSE,
    }
  }

  // Changing labware clears wells selection: labware (eg, mix)
  if ('labware' in payload.update) {
    updateOverrides = {
      ...updateOverrides,
      'wells': null,
      // TODO: Ian 2018-09-03 should we have both asp/disp for Mix?
      // if not, is dispense the right choice vs aspirate?
      'dispense_mmFromBottom': DEFAULT_MM_FROM_BOTTOM_DISPENSE,
    }
  }

  if (unsavedForm.pipette && payload.update.pipette) {
    if (typeof payload.update.pipette !== 'string') {
      // this should not happen!
      console.error('no next pipette, could not handleFormChange')
      return payload
    }
    updateOverrides = {
      ...updateOverrides,
      ...reconcileFormPipette(unsavedForm, baseState, payload.update.pipette),
    }
  }

  return {
    update: {
      ...payload.update,
      ...updateOverrides,
    },
  }
}

const reconcileFormPipette = (formData, baseState, nextPipette: stringj) => {
  const prevChannels = getChannels(formData.pipette, baseState)
  const nextChannels = getChannels(nextPipette, baseState)

  const singleToMulti = prevChannels === 1 && nextChannels === 8
  const multiToSingle = prevChannels === 8 && nextChannels === 1

  let updateOverrides = {}

  // *****
  // set any flow rates to null when pipette is changed
  // *****
  if (formData.pipette !== nextPipette) {
    if (formData.aspirate_flowRate) {
      updateOverrides = {...updateOverrides, aspirate_flowRate: null}
    }
    if (formData.dispense_flowRate) {
      updateOverrides = {...updateOverrides, dispense_flowRate: null}
    }
  }

  // *****
  // Changing pipette from multi-channel to single-channel (and vice versa)
  // modifies well selection
  // *****

  // steptypes with single set of wells (not source + dest)
  if (formData.stepType === 'mix') {
    if (singleToMulti) {
      updateOverrides = {...updateOverrides, wells: null}
    } else if (multiToSingle) {
      // multi-channel to single-channel: convert primary wells to all wells
      const labwareId = formData.labware
      const labware = labwareId && labwareIngredSelectors.getLabware(baseState)[labwareId]
      const labwareType = labware && labware.type

      updateOverrides = {
        ...updateOverrides,
        wells: _getAllWells(formData.wells, labwareType),
      }
    }
  } else {
    if (singleToMulti) {
      // source + dest well steptypes
      updateOverrides = {...updateOverrides, 'aspirate_wells': null, 'dispense_wells': null}
    } else if (multiToSingle) {
      // multi-channel to single-channel: convert primary wells to all wells
      const sourceLabwareId = formData['aspirate_labware']
      const destLabwareId = formData['dispense_labware']

      const sourceLabware = sourceLabwareId && labwareIngredSelectors.getLabware(baseState)[sourceLabwareId]
      const sourceLabwareType = sourceLabware && sourceLabware.type
      const destLabware = destLabwareId && labwareIngredSelectors.getLabware(baseState)[destLabwareId]
      const destLabwareType = destLabware && destLabware.type

      updateOverrides = {
        ...updateOverrides,
        'aspirate_wells': _getAllWells(formData['aspirate_wells'], sourceLabwareType),
        'dispense_wells': _getAllWells(formData['dispense_wells'], destLabwareType),
      }
    }
  }
  return updateOverrides
}

export default handleFormChange
