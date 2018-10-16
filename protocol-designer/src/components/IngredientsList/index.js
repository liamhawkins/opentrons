// @flow
// TODO: Ian 2018-10-09 figure out what belongs in LiquidsSidebar vs IngredientsList after #2427
import React from 'react'

import {IconButton, SidePanel, swatchColors} from '@opentrons/components'
import {sortWells} from '../../utils'
import {PDTitledList, PDListItem} from '../lists'
import StepDescription from '../StepDescription'
import LabwareDetailsCard from './LabwareDetailsCard'
import styles from './IngredientsList.css'
import type {LiquidGroupsById, LiquidGroup} from '../../labware-ingred/types'
import type {SingleLabwareLiquidState} from '../../step-generation'

type DeleteIngredient = (args: {|groupId: string, wellName?: string|}) => mixed
type EditModeIngredientGroup = (args: {|groupId: string, wellName: ?string|}) => mixed

// Props used by both IngredientsList and IngredGroupCard
type CommonProps = {|
  editModeIngredientGroup: EditModeIngredientGroup,
  deleteIngredient: DeleteIngredient,
  selected?: boolean,
|}

type CardProps = {|
  groupId: string,
  ingredGroup: LiquidGroup,
  labwareWellContents: SingleLabwareLiquidState,
  ...CommonProps,
|}

type CardState = {|
  isExpanded: boolean,
|}

class IngredGroupCard extends React.Component<CardProps, CardState> {
  constructor (props: CardProps) {
    super(props)
    this.state = {isExpanded: true} // TODO: rename to 'collapsed'
  }

  toggleAccordion = () => this.setState({isExpanded: !this.state.isExpanded})

  render () {
    const {
      ingredGroup,
      editModeIngredientGroup,
      deleteIngredient,
      selected,
      groupId,
      labwareWellContents,
    } = this.props
    const {serialize, description, name} = ingredGroup
    const {isExpanded} = this.state

    const wellsWithIngred = Object.keys(labwareWellContents)
      .sort(sortWells)
      .filter(well => labwareWellContents[well][groupId])

    if (wellsWithIngred.length < 1) {
      // do not show ingred card if it has no instances for this labware
      return null
    }

    return (
      <PDTitledList
        title={name || 'Unnamed Ingredient'}
        iconProps={{style: {fill: swatchColors(Number(groupId))}}}
        iconName='circle'
        onCollapseToggle={() => this.toggleAccordion()}
        collapsed={!isExpanded}
        selected={selected}
        onClick={() => editModeIngredientGroup({groupId, wellName: null})}
        description={<StepDescription description={description} header='Description:' />}
      >
        <PDListItem className={styles.ingredient_row_header}>
          <span>Well</span>
          <span>μL</span>
          <span>Name</span>
          <span />
        </PDListItem>

        {wellsWithIngred.map((well, i) => {
          const wellIngredForCard = labwareWellContents[well][groupId]
          const volume = wellIngredForCard && wellIngredForCard.volume

          if (volume == null) {
            // TODO: Ian 2018-06-07 use assert
            console.warn(`Got null-ish volume for well: ${well}, ingred: ${groupId}`)
            return null
          }

          return <IngredIndividual key={well}
            name={serialize
              ? `${ingredGroup.name || ''} ${i + 1}`
              : ''
            }
            wellName={well}
            canDelete
            volume={volume}
            groupId={groupId}
            editModeIngredientGroup={editModeIngredientGroup}
            deleteIngredient={deleteIngredient}
          />
        })}
      </PDTitledList>
    )
  }
}

type IndividProps = {|
  name: string,
  wellName: string,
  volume: number,
  // concentration?: string,
  canDelete: boolean,
  groupId: string,
  editModeIngredientGroup: EditModeIngredientGroup,
  deleteIngredient: DeleteIngredient,
|}

function IngredIndividual (props: IndividProps) {
  const {
    name,
    wellName,
    volume,
    // concentration, // TODO LATER Ian 2018-02-22: concentration is removed from MVP. Remove all traces of it, or add it back in
    canDelete,
    groupId,
    deleteIngredient,
  } = props

  return (
    <PDListItem border hoverable>
      <span>{wellName}</span>
      <span>{volume ? volume + ' μL' : '-'}</span>
      <span>{name}</span>
      {canDelete && <IconButton
        className={styles.close_icon}
        name='close'
        onClick={
          () => window.confirm(`Are you sure you want to delete well ${wellName} ?`) &&
          deleteIngredient({wellName, groupId})
        } />}
    </PDListItem>
  )
}

type Props = {
  ...CommonProps,
  liquidGroupsById: LiquidGroupsById,
  labwareWellContents: SingleLabwareLiquidState,
  selectedIngredientGroupId: ?string,
}

export default function IngredientsList (props: Props) {
  const {
    labwareWellContents,
    liquidGroupsById,
    editModeIngredientGroup,
    deleteIngredient,
    selectedIngredientGroupId,
  } = props

  return (
    <SidePanel title='Name & Liquids'>
        <LabwareDetailsCard />

        {Object.keys(liquidGroupsById).map((groupIdForCard) =>
          <IngredGroupCard key={groupIdForCard}
            editModeIngredientGroup={editModeIngredientGroup}
            deleteIngredient={deleteIngredient}
            labwareWellContents={labwareWellContents}
            ingredGroup={liquidGroupsById[groupIdForCard]}
            groupId={groupIdForCard}
            selected={selectedIngredientGroupId === groupIdForCard}
          />)
        }
    </SidePanel>
  )
}
