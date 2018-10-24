// @flow
import * as React from 'react'
import {Formik} from 'formik'
import get from 'lodash/get'
import find from 'lodash/find'
import map from 'lodash/map'
import set from 'lodash/set'

import {WPA_PSK_SECURITY, WPA_EAP_SECURITY} from '../../../http-api-client'

import {DropdownField} from '@opentrons/components'
import {BottomButtonBar} from '../../modals'
import ConnectFormField, {CONNECT_FIELD_ID_PREFIX} from './ConnectFormField'
import FormTable, {FormTableRow} from './FormTable'

import type {
  WifiSecurityType,
  WifiEapOptionsList,
  WifiKeysList,
  WifiAuthField,
  WifiConfigureRequest,
} from '../../../http-api-client'

type Props = {
  // TODO(mc, 2018-10-22): optional SSID
  ssid: string,
  securityType: WifiSecurityType,
  eapOptions: ?WifiEapOptionsList,
  keys: ?WifiKeysList,
  configure: WifiConfigureRequest => mixed,
  addKey: File => mixed,
  close: () => mixed,
}

type State = {|
  showPassword: {[name: string]: boolean},
|}

const WIFI_PSK_FIELDS = [
  {name: 'psk', displayName: 'Password', type: 'password', required: true},
]

// all eap options go in a sub-object `eapConfig`
// eap method is stored under eapConfig.eapType
const EAP_FIELD_PREFIX = 'eapConfig.'
const EAP_METHOD_FIELD = `${EAP_FIELD_PREFIX}eapType`
const EAP_METHOD_FIELD_ID = `${CONNECT_FIELD_ID_PREFIX}${EAP_METHOD_FIELD}`

export default class ConnectForm extends React.Component<Props, State> {
  constructor (props: Props) {
    super(props)
    this.state = {showPassword: {}}
  }

  onSubmit = (values: {[name: string]: string}) => {
    this.props.configure({
      ssid: this.props.ssid,
      securityType: this.props.securityType,
      hidden: !this.props.ssid,
      ...values,
    })

    this.props.close()
  }

  toggleShowPassword = (name: string) => {
    this.setState({
      showPassword: {
        ...this.state.showPassword,
        [name]: !this.state.showPassword[name],
      },
    })
  }

  render () {
    const {showPassword} = this.state
    const {securityType, eapOptions, keys, addKey, close} = this.props

    // TODO(mc, 2018-10-18): form validation
    return (
      <Formik
        onSubmit={this.onSubmit}
        render={formProps => {
          const {
            values,
            handleChange,
            handleSubmit,
            setFieldValue,
            setValues,
          } = formProps
          const eapMethod = get(values, EAP_METHOD_FIELD)
          let fields: Array<WifiAuthField> = []

          if (securityType === WPA_PSK_SECURITY) {
            fields = WIFI_PSK_FIELDS
          } else if (securityType === WPA_EAP_SECURITY) {
            const selectedEapMethod = find(eapOptions, {name: eapMethod})
            fields = get(selectedEapMethod, 'options', []).map(field => ({
              ...field,
              name: `${EAP_FIELD_PREFIX}${field.name}`,
            }))
          }

          return (
            <form onSubmit={handleSubmit}>
              <FormTable>
                {securityType === WPA_EAP_SECURITY && (
                  <FormTableRow
                    label="* Authentication:"
                    labelFor={EAP_METHOD_FIELD_ID}
                  >
                    <DropdownField
                      id={EAP_METHOD_FIELD_ID}
                      name={EAP_METHOD_FIELD}
                      value={eapMethod}
                      options={map(eapOptions, o => ({
                        name: o.displayName || o.name,
                        value: o.name,
                      }))}
                      onChange={e => {
                        // reset all other fields on EAP type change
                        setValues(set({}, EAP_METHOD_FIELD, e.target.value))
                      }}
                    />
                  </FormTableRow>
                )}
                {fields.map(field => (
                  <ConnectFormField
                    key={field.name}
                    field={field}
                    value={get(values, field.name, '')}
                    keys={keys}
                    showPassword={!!showPassword[field.name]}
                    onChange={handleChange}
                    onValueChange={setFieldValue}
                    addKey={addKey}
                    toggleShowPassword={this.toggleShowPassword}
                  />
                ))}
              </FormTable>
              <BottomButtonBar
                buttons={[
                  {children: 'Cancel', onClick: close},
                  {children: 'Join', type: 'submit'},
                ]}
              />
            </form>
          )
        }}
      />
    )
  }
}
