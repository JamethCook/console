/**
 * Copyright 2022 Redpanda Data, Inc.
 *
 * Use of this software is governed by the Business Source License
 * included in the file https://github.com/redpanda-data/redpanda/blob/dev/licenses/bsl.md
 *
 * As of the Change Date specified in that file, in accordance with
 * the Business Source License, use of this software will be governed
 * by the Apache License, Version 2.0
 */

import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  FormField,
  Input,
  NumberInput,
  Text,
  createStandaloneToast,
} from '@redpanda-data/ui';
import { Link as ChLink } from '@redpanda-data/ui';
import { action, makeObservable, observable } from 'mobx';
import { observer } from 'mobx-react';
import { Link } from 'react-router-dom';
import { PipelineCreate } from '../../../protogen/redpanda/api/dataplane/v1alpha2/pipeline_pb';
import { appGlobal } from '../../../state/appGlobal';
import { pipelinesApi, rpcnSecretManagerApi } from '../../../state/backendApi';
import { DefaultSkeleton } from '../../../utils/tsxUtils';
import PageContent from '../../misc/PageContent';
import PipelinesYamlEditor from '../../misc/PipelinesYamlEditor';
import Tabs from '../../misc/tabs/Tabs';
import { PageComponent, type PageInitHelper } from '../Page';
import { formatPipelineError } from './errors';
import { MAX_TASKS, MIN_TASKS, tasksToCPU } from './tasks';
const { ToastContainer, toast } = createStandaloneToast();

const exampleContent = `
`;

@observer
class RpConnectPipelinesCreate extends PageComponent<{}> {
  @observable fileName = '';
  @observable description = '';
  @observable tasks = MIN_TASKS;
  @observable editorContent = exampleContent;
  @observable isCreating = false;
  @observable secrets: string[] = [];
  constructor(p: any) {
    super(p);
    makeObservable(this, undefined, { autoBind: true });
  }

  initPage(p: PageInitHelper): void {
    p.title = 'Create Pipeline';
    p.addBreadcrumb('Redpanda Connect', '/connect-clusters');
    p.addBreadcrumb('Create Pipeline', '');

    this.refreshData(true);
    // get secrets
    rpcnSecretManagerApi.refreshSecrets(true);
    appGlobal.onRefresh = () => this.refreshData(true);
  }

  refreshData(_force: boolean) {
    pipelinesApi.refreshPipelines(_force);
  }

  render() {
    if (!pipelinesApi.pipelines) return DefaultSkeleton;
    if (rpcnSecretManagerApi.secrets) {
      // inject secrets to editor
      this.secrets.updateWith(rpcnSecretManagerApi.secrets.map((value) => value.id));
    }
    const alreadyExists = pipelinesApi.pipelines.any((x) => x.id === this.fileName);
    const isNameEmpty = this.fileName.trim().length === 0;

    return (
      <PageContent>
        <ToastContainer />

        <Box my="2">
          For help creating your pipeline, see our{' '}
          <ChLink href="https://docs.redpanda.com/redpanda-cloud/develop/connect/connect-quickstart/" isExternal>
            quickstart documentation
          </ChLink>
          , our{' '}
          <ChLink href="https://docs.redpanda.com/redpanda-cloud/develop/connect/cookbooks/" isExternal>
            library of examples
          </ChLink>
          , or our{' '}
          <ChLink href="https://docs.redpanda.com/redpanda-cloud/develop/connect/components/catalog/" isExternal>
            connector catalog
          </ChLink>
          .
        </Box>

        <Flex flexDirection="column">
          <FormField label="Pipeline name" isInvalid={alreadyExists} errorText="Pipeline name is already in use">
            <Flex alignItems="center" gap="2">
              <Input
                placeholder="Enter a config name..."
                data-testid="pipelineName"
                pattern="[a-zA-Z0-9_\-]+"
                isRequired
                value={this.fileName}
                onChange={(x) => (this.fileName = x.target.value)}
                width={500}
              />
            </Flex>
          </FormField>
          <FormField label="Description">
            <Input
              data-testid="pipelineDescription"
              value={this.description}
              onChange={(x) => (this.description = x.target.value)}
              width={500}
            />
          </FormField>
          <FormField label="Tasks">
            <NumberInput
              value={this.tasks}
              onChange={(e) => (this.tasks = Number(e ?? MIN_TASKS))}
              min={MIN_TASKS}
              max={MAX_TASKS}
              maxWidth={150}
            />
          </FormField>
        </Flex>

        <Box mt="4">
          <PipelineEditor yaml={this.editorContent} onChange={(x) => (this.editorContent = x)} secrets={this.secrets} />
        </Box>

        <Flex alignItems="center" gap="4">
          <Button
            variant="solid"
            isDisabled={alreadyExists || isNameEmpty || this.isCreating}
            loadingText="Creating..."
            isLoading={this.isCreating}
            onClick={action(() => this.createPipeline())}
          >
            Create
          </Button>
          <Link to="/connect-clusters">
            <Button variant="link">Cancel</Button>
          </Link>
        </Flex>
      </PageContent>
    );
  }

  async createPipeline() {
    this.isCreating = true;

    pipelinesApi
      .createPipeline(
        new PipelineCreate({
          configYaml: this.editorContent,
          description: this.description,
          displayName: this.fileName,
          resources: {
            cpuShares: tasksToCPU(this.tasks) || '0',
            memoryShares: '0', // still required by API but unused
          },
        }),
      )
      .then(async () => {
        toast({
          status: 'success',
          duration: 4000,
          isClosable: false,
          title: 'Pipeline created',
        });
        await pipelinesApi.refreshPipelines(true);
        appGlobal.history.push('/connect-clusters');
      })
      .catch((err) => {
        toast({
          status: 'error',
          duration: null,
          isClosable: true,
          title: 'Failed to create pipeline',
          description: formatPipelineError(err),
        });
      })
      .finally(() => {
        this.isCreating = false;
      });
  }
}

export default RpConnectPipelinesCreate;

export const PipelineEditor = observer(
  (p: {
    yaml: string;
    onChange: (newYaml: string) => void;
    secrets?: string[];
  }) => {
    return (
      <Tabs
        tabs={[
          {
            key: 'config',
            title: 'Configuration',
            content: () => (
              <Box>
                {/* yaml editor */}
                <Flex height="400px" maxWidth="800px">
                  <PipelinesYamlEditor
                    defaultPath="config.yaml"
                    path="config.yaml"
                    value={p.yaml}
                    onChange={(e) => {
                      if (e) p.onChange(e);
                    }}
                    language="yaml"
                  />
                </Flex>
                {isKafkaConnectPipeline(p.yaml) && (
                  <Alert status="error" my={2}>
                    <AlertIcon />
                    <Text>
                      This looks like a Kafka Connect configuration. For help with Redpanda Connect configurations,{' '}
                      <ChLink
                        target="_blank"
                        href="https://docs.redpanda.com/redpanda-cloud/develop/connect/connect-quickstart/"
                      >
                        see our quickstart documentation
                      </ChLink>
                      .
                    </Text>
                  </Alert>
                )}
              </Box>
            ),
          },
          {
            key: 'preview',
            title: 'Pipeline preview',
            content: <></>,
            disabled: true,
          },
        ]}
      />
    );
  },
);

/**
 * Determines whether a given string represents a Kafka Connect configuration.
 *
 * This function first attempts to parse the input as JSON. If the parsing is successful,
 * it checks for the presence of specific Kafka Connect-related keys commonly found in
 * configurations, such as "connector.class", "key.converter", and "value.converter".
 *
 * @param {string | undefined} value - The input string to evaluate as a potential Kafka Connect configuration.
 * @returns {boolean} - Returns `true` if the string is a valid JSON object containing
 *                      at least a subset of Kafka Connect configuration keys; otherwise, returns `false`.
 *
 * @example
 * ```typescript
 * const configString = `{
 *     "connector.class": "com.ibm.eventstreams.connect.mqsink.MQSinkConnector",
 *     "key.converter": "org.apache.kafka.connect.converters.ByteArrayConverter",
 *     "value.converter": "org.apache.kafka.connect.converters.ByteArrayConverter"
 * }`;
 *
 * const result = isKafkaConnectPipeline(configString);
 * console.log(result); // Output: true
 * ```
 */
const isKafkaConnectPipeline = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }
  // Attempt to parse the input string as JSON
  let json: object;
  try {
    json = JSON.parse(value);
  } catch (e) {
    // If parsing fails, it's not a valid JSON and hence not a Kafka Connect config
    return false;
  }

  const kafkaConfigKeys = [
    'connector.class',
    'key.converter',
    'value.converter',
    'header.converter',
    'tasks.max.enforce',
    'errors.log.enable',
  ];

  const matchCount = kafkaConfigKeys.filter((key) => key in json).length;

  return matchCount > 0;
};
