// @flow
import {createSelector} from 'reselect'
import last from 'lodash/last'
import mapValues from 'lodash/mapValues'
import reduce from 'lodash/reduce'
import takeWhile from 'lodash/takeWhile'
import uniqBy from 'lodash/uniqBy'
import { getIsTiprack } from '@opentrons/shared-data'
import type {BaseState, Selector} from '../../types'
import {getAllWellsForLabware} from '../../constants'
import * as StepGeneration from '../../step-generation'
import {selectors as steplistSelectors} from '../../steplist'
import {selectors as pipetteSelectors} from '../../pipettes'
import {selectors as labwareIngredSelectors} from '../../labware-ingred/reducers'
import type {Labware} from '../../labware-ingred/types'

const all96Tips = reduce(
  StepGeneration.tiprackWellNamesFlat,
  (acc: {[string]: boolean}, wellName: string) => ({...acc, [wellName]: true}),
  {}
)

// NOTE this just adds missing well keys to the labware-ingred 'deck setup' liquid state
export const getLabwareLiquidState: Selector<StepGeneration.LabwareLiquidState> = createSelector(
  labwareIngredSelectors.getIngredientLocations,
  labwareIngredSelectors.getLabware,
  (ingredLocations, allLabware) => {
    const allLabwareIds: Array<string> = Object.keys(allLabware)
    return allLabwareIds.reduce((
      acc: StepGeneration.LabwareLiquidState,
      labwareId
    ): StepGeneration.LabwareLiquidState => {
      const labwareType = allLabware[labwareId] && allLabware[labwareId].type
      const allWells = labwareType ? getAllWellsForLabware(labwareType) : []
      const liquidStateForLabwareAllWells = allWells.reduce(
        (innerAcc: StepGeneration.SingleLabwareLiquidState, well) => ({
          ...innerAcc,
          [well]: (ingredLocations[labwareId] && ingredLocations[labwareId][well]) || {},
        }),
        {}
      )
      return {
        ...acc,
        [labwareId]: liquidStateForLabwareAllWells,
      }
    }, {})
  }
)

function labwareConverter (labwareAppState: {[labwareId: string]: ?Labware}): {[labwareId: string]: StepGeneration.LabwareData} {
  // Convert internal PD labware objects into JSON spec labware objects
  // (just removes keys & makes flow happy)
  return mapValues(labwareAppState, (l: Labware): StepGeneration.LabwareData => ({
    name: l.name,
    type: l.type,
    slot: l.slot,
  }))
}

export const getInitialRobotState: BaseState => StepGeneration.RobotState = createSelector(
  pipetteSelectors.equippedPipettes,
  labwareIngredSelectors.getLabware,
  getLabwareLiquidState,
  (pipettes, labwareAppState, labwareLiquidState) => {
    type TipState = $PropertyType<StepGeneration.RobotState, 'tipState'>
    type TiprackTipState = $PropertyType<TipState, 'tipracks'>

    const labware = labwareConverter(labwareAppState)

    const tipracks: TiprackTipState = reduce(
      labware,
      (acc: TiprackTipState, labwareData: StepGeneration.LabwareData, labwareId: string) => {
        const isTiprack = getIsTiprack(labwareData.type)
        if (labwareData.type && isTiprack) {
          return {
            ...acc,
            // TODO LATER Ian 2018-05-18 use shared-data wells instead of assuming 96 tips?
            [labwareId]: {...all96Tips},
          }
        }
        return acc
      },
      {})

    type PipetteTipState = {[pipetteId: string]: boolean}
    const pipetteTipState: PipetteTipState = reduce(
      pipettes,
      (acc: PipetteTipState, pipetteData: StepGeneration.PipetteData) =>
        ({
          ...acc,
          [pipetteData.id]: false, // start with no tips
        }),
      {})

    const pipetteLiquidState = reduce(
      pipettes,
      (acc, pipetteData: StepGeneration.PipetteData, pipetteId: string) => ({
        ...acc,
        [pipetteId]: (pipetteData.channels > 1)
          ? {'0': {}, '1': {}, '2': {}, '3': {}, '4': {}, '5': {}, '6': {}, '7': {}}
          : {'0': {}},
      }),
    {})

    return {
      instruments: pipettes,
      labware,
      tipState: {
        tipracks,
        pipettes: pipetteTipState,
      },
      liquidState: {
        pipettes: pipetteLiquidState,
        labware: labwareLiquidState,
      },
    }
  }
)
function compoundCommandCreatorFromFormData (validatedForm: StepGeneration.CommandCreatorData): ?StepGeneration.CompoundCommandCreator {
  switch (validatedForm.stepType) {
    case 'consolidate':
      return StepGeneration.consolidate(validatedForm)
    case 'transfer':
      return StepGeneration.transfer(validatedForm)
    case 'distribute':
      return StepGeneration.distribute(validatedForm)
    case 'mix':
      return StepGeneration.mix(validatedForm)
    default:
      return null
  }
}

// exposes errors and last valid robotState
export const robotStateTimeline: Selector<StepGeneration.Timeline> = createSelector(
  steplistSelectors.validatedForms,
  steplistSelectors.orderedSteps,
  getInitialRobotState,
  (forms, orderedSteps, initialRobotState) => {
    const allFormData: Array<StepGeneration.CommandCreatorData | null> = orderedSteps.map(stepId => {
      return (forms[stepId] && forms[stepId].validatedForm) || null
    })

    console.log({forms, orderedSteps, allFormData})

    // TODO: Ian 2018-06-14 `takeWhile` isn't inferring the right type
    // $FlowFixMe
    const continuousValidForms: Array<StepGeneration.CommandCreatorData> = takeWhile(
      allFormData,
      f => f
    )

    const commandCreators = continuousValidForms.reduce(
      (acc: Array<StepGeneration.CommandCreator>, formData, formIndex) => {
        const {stepType} = formData
        let reducedCommandCreator = null

        if (formData.stepType === 'pause') {
          reducedCommandCreator = StepGeneration.delay(formData)
        } else { // NOTE: compound return an array of command creators, atomic steps only return one command creator
          const compoundCommandCreator: ?StepGeneration.CompoundCommandCreator = compoundCommandCreatorFromFormData(formData)
          reducedCommandCreator = compoundCommandCreator && StepGeneration.reduceCommandCreators(compoundCommandCreator(initialRobotState))
        }
        if (!reducedCommandCreator) {
          // TODO Ian 2018-05-08 use assert
          console.warn(`StepType "${stepType}" not yet implemented`)
          return acc
        }

        // Drop tips eagerly, per pipette
        // NOTE: this assumes all step forms that use a pipette have both
        // 'pipette' and 'changeTip' fields (and they're not named something else).
        const pipetteId = formData.pipette
        if (pipetteId) {
          const nextFormForPipette = continuousValidForms
            .slice(formIndex + 1)
            .find(form => form.pipette === pipetteId)

          const willReuseTip = nextFormForPipette && nextFormForPipette.changeTip === 'never'
          if (!willReuseTip) {
            return [
              ...acc,
              StepGeneration.reduceCommandCreators([
                reducedCommandCreator,
                StepGeneration.dropTip(pipetteId),
              ]),
            ]
          }
        }

        return [...acc, reducedCommandCreator]
      }, [])

    const timeline = StepGeneration.commandCreatorsTimeline(commandCreators)(initialRobotState)

    return timeline
  }
)

type WarningsPerStep = {[stepId: number | string]: ?Array<StepGeneration.CommandCreatorWarning>}
export const timelineWarningsPerStep: Selector<WarningsPerStep> = createSelector(
  steplistSelectors.orderedSteps,
  robotStateTimeline,
  (orderedSteps, timeline) => timeline.timeline.reduce((acc: WarningsPerStep, frame, timelineIndex) => {
    const stepId = orderedSteps[timelineIndex]

    // remove warnings of duplicate 'type'. chosen arbitrarily
    return {
      ...acc,
      [stepId]: uniqBy(frame.warnings, w => w.type),
    }
  }, {})
)

export const getErrorStepId: Selector<?number> = createSelector(
  steplistSelectors.orderedSteps,
  robotStateTimeline,
  (orderedSteps, timeline) => {
    const hasErrors = timeline.errors && timeline.errors.length > 0
    if (hasErrors) {
      // the frame *after* the last frame in the timeline is the error-throwing one
      const errorIndex = timeline.timeline.length
      const errorStepId = orderedSteps[errorIndex]
      return errorStepId
    }
    return null
  }
)

export const lastValidRobotState: Selector<StepGeneration.RobotState> = createSelector(
  robotStateTimeline,
  getInitialRobotState,
  (timeline, initialRobotState) => {
    const lastTimelineFrame = last(timeline.timeline)
    return (lastTimelineFrame && lastTimelineFrame.robotState) || initialRobotState
  }
)
