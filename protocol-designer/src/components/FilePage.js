// @flow
import * as React from 'react'
import {
  Card,
  FormGroup,
  InputField,
  InstrumentGroup,
  OutlineButton,
  PrimaryButton,
} from '@opentrons/components'
import i18n from '../localization'
import type {FormConnector} from '../utils'
import styles from './FilePage.css'
import formStyles from '../components/forms.css'

export type FilePageProps = {
  formConnector: FormConnector<any>,
  isFormAltered: boolean,
  instruments: React.ElementProps<typeof InstrumentGroup>,
  goToNextPage: () => mixed,
  saveFileMetadata: () => mixed,
  swapPipettes: () => mixed,
}

const FilePage = ({formConnector, isFormAltered, instruments, saveFileMetadata, goToNextPage, swapPipettes}: FilePageProps) => {
  const handleSubmit = (e: SyntheticEvent<*>) => {
    // blur focused field on submit
    if (document && document.activeElement) document.activeElement.blur()
    saveFileMetadata()
    e.preventDefault()
  }
  return (
    <div className={styles.file_page}>
      <Card title='Information'>
        <form onSubmit={handleSubmit} className={styles.card_content}>
          <div className={formStyles.row_wrapper}>
            <FormGroup label='Protocol Name:' className={formStyles.column_1_2}>
              <InputField placeholder='Untitled' {...formConnector('protocol-name')} />
            </FormGroup>

            <FormGroup label='Organization/Author:' className={formStyles.column_1_2}>
              <InputField {...formConnector('author')} />
            </FormGroup>
          </div>

          <FormGroup label='Description:'>
            <InputField {...formConnector('description')}/>
          </FormGroup>
          <div className={styles.button_row}>
            <OutlineButton type="submit" className={styles.update_button} disabled={!isFormAltered}>
              {isFormAltered ? 'UPDATE' : 'UPDATED'}
            </OutlineButton>
          </div>
        </form>
      </Card>

      <Card title='Pipettes'>
        <div className={styles.card_content}>
          <InstrumentGroup {...instruments} showMountLabel />
          <OutlineButton
            onClick={swapPipettes}
            className={styles.swap_button}
            iconName='swap-horizontal'
          >
            Swap
          </OutlineButton>
        </div>
      </Card>

      <div className={styles.button_row}>
        <PrimaryButton
          onClick={goToNextPage}
          className={styles.continue_button}
          iconName="arrow-right"
        >
          {i18n.t('button.continue_to_liquids')}
        </PrimaryButton>
      </div>
    </div>
  )
}

export default FilePage
